import { Inject, Injectable } from "@nestjs/common";
import {
  CONVERSATION_REPOSITORY,
  EVENT_PUBLISHER,
  LLM_PROVIDER,
  WHATSAPP_ACCOUNT_REPOSITORY,
  WHATSAPP_PROVIDER,
  LLM_RUN_REPOSITORY,
  PRODUCT_REPOSITORY,
} from "../../../common/di-tokens";
import type { ConversationRepository } from "../../../domain/ports/conversation-repository";
import type { LlmProvider } from "../../../domain/ports/llm-provider";
import type { WhatsappAccountRepository } from "../../../domain/ports/whatsapp-account-repository";
import type { WhatsappProvider } from "../../../domain/ports/whatsapp-provider";
import type { ProductRepository } from "../../../domain/ports/product-repository";
import type { LlmJobInput } from "../../../domain/ports/llm-job-queuer";
import type {
  LlmCompletionRequest,
  LlmToolCall,
} from "../../../domain/ports/llm-provider";
import type { LlmRunRepository } from "../../../domain/ports/llm-run-repository";
import { WhatsAppTokenExpiredError } from "../../../domain/errors";
import { TenantContextService } from "../../../common/tenant-context/tenant-context.service";
import { ToolCatalog } from "../../../domain/llm/tool-catalog";
import { buildPrompt } from "./prompt";
import { ToolExecutor } from "./tool-executor";
import type { EventPublisher } from "../../../domain/ports/event-publisher";

const MAX_TOOL_ITERATIONS = 5;
const SYSTEM_PROMPT =
  "Eres un asistente virtual de atención al cliente para un negocio en WhatsApp. " +
  "Responde de forma concisa, cordial y útil. " +
  "Si el cliente pregunta por productos, servicios, precios, disponibilidad o detalles de lo que ofrece el negocio, " +
  "debes consultar la herramienta `search_catalog` para obtener la información real antes de responder.";

@Injectable()
export class ConversationEngineService {
  private readonly catalog = new ToolCatalog();

  constructor(
    @Inject(CONVERSATION_REPOSITORY) private readonly conv: ConversationRepository,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Inject(WHATSAPP_ACCOUNT_REPOSITORY)
    private readonly accounts: WhatsappAccountRepository,
    @Inject(WHATSAPP_PROVIDER) private readonly wa: WhatsappProvider,
    @Inject(LLM_RUN_REPOSITORY) private readonly runs: LlmRunRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(PRODUCT_REPOSITORY) private readonly products: ProductRepository,
    private readonly ctx: TenantContextService,
    private readonly executor: ToolExecutor,
  ) {
    this.catalog.register(
      {
        name: "search_catalog",
        description:
          "Busca productos y servicios disponibles en el catálogo del negocio (precios, descripción, duración, categoría).",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Término de búsqueda, nombre del producto o servicio, o categoría (ej. 'corte', 'precio', 'manicure', 'café').",
            },
          },
        },
      },
      async (args, ctx) => {
        const { query } = (args ?? {}) as { query?: string };
        const found = await this.products.search(ctx.tenantId, query ?? "", 6);
        return {
          toolCallId: "",
          name: "search_catalog",
          ok: true,
          output: found.map((p) => ({
            name: p.name,
            description: p.description,
            price: p.price,
            currency: p.currency,
            type: p.type,
            category: p.category,
            durationMinutes: p.durationMinutes,
          })),
        };
      },
    );
  }

  async respond(input: LlmJobInput): Promise<void> {
    const tenantId = input.tenantId;
    const conversationId = input.conversationId;

    const start = Date.now();
    let started = false;
    try {
      const dup = await this.runs.start({
        tenantId,
        conversationId,
        inboundMessageId: input.inboundMessageId,
        requestId: input.requestId,
        driver: "llm",
        requestedModel: "openrouter",
      });
      if (dup === "duplicated") return;
      started = true;
      // El run ya existe (RUNNING): el panel lo ve aparecer de inmediato.
      await this.events.publish({
        event: "conversation.changed",
        tenantId,
        conversationId,
      });
      await this.runOnce(input, start);
    } catch (e) {
      // Sin este catch, una excepción (timeout/429 de OpenRouter, Meta caído)
      // deja la fila en RUNNING para siempre y el fallo es invisible.
      if (started) {
        const latencyMs = Date.now() - start;
        await this.runs.markFailed(tenantId, input.requestId, {
          status: "FAILED",
          resolvedModel: null,
          finishReason: "error",
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          toolCalls: 0,
          latencyMs,
          errorCode: e instanceof Error ? e.name : "unknown",
          errorMessage: e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500),
          outboundMessageId: null,
        });
      }
      throw e;
    } finally {
      // Estado terminal (SUCCEEDED/FAILED/SKIPPED) o mensaje saliente nuevo:
      // con UN publish basta para que el panel refresque runs y mensajes.
      if (started) {
        await this.events.publish({
          event: "conversation.changed",
          tenantId,
          conversationId,
        });
      }
    }
  }

  private async runOnce(input: LlmJobInput, start: number): Promise<void> {
    const tenantId = input.tenantId;
    const conversationId = input.conversationId;

    const conversation = await this.conv.getConversation(tenantId, conversationId);
    if (conversation.status !== "BOT_ACTIVE") {
      await this.runs.markSkipped(tenantId, input.requestId);
      return;
    }

    const history = await this.conv.listRecentMessages(tenantId, conversationId, 50);
    const messages = buildPrompt(SYSTEM_PROMPT, history);
    const executed = new Set<string>();
    let toolExecCount = 0;
    let resolvedModel: string | null = null;
    let finishReason: string | null = "stop";
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const req: LlmCompletionRequest = {
        messages,
        tools: this.catalog.list().length ? this.catalog.list() : undefined,
      };
      const res = await this.llm.complete(req);
      resolvedModel = res.model ?? null;
      finishReason = res.finishReason;
      promptTokens += res.usage.promptTokens;
      completionTokens += res.usage.completionTokens;
      totalTokens += res.usage.totalTokens;

      if (res.toolCalls && res.toolCalls.length > 0 && iter < MAX_TOOL_ITERATIONS - 1) {
        const key = (c: LlmToolCall) => c.name + "::" + JSON.stringify(c.arguments);
        const unique = res.toolCalls.filter((c) => !executed.has(key(c)));
        if (unique.length > 0) {
          executed.add(key(unique[0]));
          toolExecCount++;
          const results = await this.executor.execute(this.catalog, [unique[0]], {
            tenantId,
            conversationId,
          });
          for (const r of results) {
            messages.push({ role: "tool", content: JSON.stringify(r.output), toolCallId: r.toolCallId });
          }
          continue;
        }
      }

      if (res.text) {
        const account = await this.accounts.findById(tenantId, conversation.accountId);
        if (!account) {
          throw new Error("Active WhatsApp account not found for conversation");
        }
        let sent;
        try {
          sent = await this.wa.sendTextMessage({
            to: conversation.customerWaId,
            text: res.text,
            phoneNumberId: account.phoneNumberId,
            accessToken: account.accessToken,
          });
        } catch (error) {
          // Token muerto detectado en el envío: marcar para que la renovación
          // programada la re-firme y el siguiente envío no use un token muerto.
          if (error instanceof WhatsAppTokenExpiredError) {
            try {
              await this.accounts.markTokenExpired(account.id);
            } catch {
              // Best-effort: no ocultar el error real del envío.
            }
          }
          throw error;
        }
        const out = await this.conv.recordOutboundMessage(
          { tenantId, conversationId },
          {
            providerMessageId:
              sent.providerMessageId ?? `pending:${input.requestId}`,
            type: "text",
            content: res.text,
          },
        );
        const latencyMs = Date.now() - start;
        await this.runs.markSucceeded(tenantId, input.requestId, {
          status: "SUCCEEDED",
          resolvedModel,
          finishReason,
          promptTokens,
          completionTokens,
          totalTokens,
          toolCalls: toolExecCount,
          latencyMs,
          errorCode: null,
          errorMessage: null,
          outboundMessageId: out?.id ?? null,
        });
        return;
      }

      const latencyMs = Date.now() - start;
      await this.runs.markSucceeded(tenantId, input.requestId, {
        status: "SUCCEEDED",
        resolvedModel,
        finishReason,
        promptTokens,
        completionTokens,
        totalTokens,
        toolCalls: toolExecCount,
        latencyMs,
        errorCode: null,
        errorMessage: null,
        outboundMessageId: null,
      });
      return;
    }

    const latencyMs = Date.now() - start;
    await this.runs.markFailed(tenantId, input.requestId, {
      status: "FAILED",
      resolvedModel,
      finishReason: "error",
      promptTokens,
      completionTokens,
      totalTokens,
      toolCalls: toolExecCount,
      latencyMs,
      errorCode: "tool_loop_exceeded",
      errorMessage: "Tool loop exceeded max iterations",
      outboundMessageId: null,
    });
  }
}
