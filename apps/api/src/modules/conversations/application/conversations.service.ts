import { Inject, Injectable } from "@nestjs/common";
import {
  CONVERSATION_REPOSITORY,
  EVENT_PUBLISHER,
  LLM_RUN_REPOSITORY,
  WHATSAPP_ACCOUNT_REPOSITORY,
  WHATSAPP_PROVIDER,
} from "../../../common/di-tokens";
import type {
  ConversationPage,
  ConversationRepository,
  ListConversationsOptions,
  ListMessagesOptions,
} from "../../../domain/ports/conversation-repository";
import type {
  ListLlmRunsOptions,
  LlmRunRepository,
} from "../../../domain/ports/llm-run-repository";
import { NotFoundError, WhatsAppTokenExpiredError } from "../../../domain/errors";
import type { ConversationRecord, MessageRecord } from "../../../domain/conversations/entities";
import type { LlmRunRecord } from "../../../domain/llm/entities";
import { parseDeliveryStatusUpdates, parseInboundMessages } from "../../../domain/conversations/meta-message.mapper";
import type { WhatsappAccountRepository } from "../../../domain/ports/whatsapp-account-repository";
import type { WhatsappProvider } from "../../../domain/ports/whatsapp-provider";
import type { EventPublisher } from "../../../domain/ports/event-publisher";

export interface InboundEventPayload {
  tenantId: string;
  accountId: string;
  /** `change.value` crudo del webhook de Meta (ver `meta-message.mapper`). */
  payload: unknown;
}

export interface SendMessageInput {
  tenantId: string;
  conversationId: string;
  text: string;
}

/**
 * Casos de uso de conversaciones y mensajes (F2-4).
 *
 * `ingestInbound` es el punto de entrada del worker: un `change.value` puede
 * traer mensajes entrantes y, en el mismo bloque, estados de entrega
 * (`statuses[]`) de mensajes anteriores. La frontera de idempotencia vive en el
 * repositorio (`provider_message_id` UNIQUE), así que reintentar un job cuya
 * pieza ya se escribió es un no-op seguro.
 */
@Injectable()
export class ConversationsService {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private readonly conversations: ConversationRepository,
    @Inject(WHATSAPP_ACCOUNT_REPOSITORY)
    private readonly accounts: WhatsappAccountRepository,
    @Inject(WHATSAPP_PROVIDER)
    private readonly whatsapp: WhatsappProvider,
    @Inject(LLM_RUN_REPOSITORY)
    private readonly runs: LlmRunRepository,
    @Inject(EVENT_PUBLISHER)
    private readonly events: EventPublisher,
  ) {}

  async ingestInbound(event: InboundEventPayload): Promise<{
    messagesInserted: number;
    statusesApplied: number;
    inserted: Array<{ conversationId: string; messageId: string; providerMessageId: string }>;
  }> {
    const drafts = parseInboundMessages(event.payload);
    const statuses = parseDeliveryStatusUpdates(event.payload);

    const inserted: Array<{ conversationId: string; messageId: string; providerMessageId: string }> = [];
    let messagesInserted = 0;
    for (const draft of drafts) {
      const result = await this.conversations.recordInboundMessage(
        { tenantId: event.tenantId, accountId: event.accountId },
        draft,
      );
      if (result !== "duplicated") {
        inserted.push({
          conversationId: result.conversation.id,
          messageId: result.message.id,
          providerMessageId: result.message.providerMessageId,
        });
        messagesInserted += 1;
      }
    }

    let statusesApplied = 0;
    for (const update of statuses) {
      if (await this.conversations.recordDeliveryStatus(event.tenantId, update)) {
        statusesApplied += 1;
      }
    }

    // Aviso en tiempo real: un mensaje nuevo (o un `statuses[]` aplicado) deja
    // o actualiza el inbox; el panel refresca sin esperar al polling.
    for (const item of inserted) {
      await this.events.publish({
        event: "conversation.changed",
        tenantId: event.tenantId,
        conversationId: item.conversationId,
      });
    }
    if (statusesApplied > 0) {
      await this.events.publish({
        event: "conversation.changed",
        tenantId: event.tenantId,
      });
    }

    return { messagesInserted, statusesApplied, inserted };
  }

  async listByTenant(
    tenantId: string,
    options: ListConversationsOptions,
  ): Promise<ConversationPage<ConversationRecord>> {
    return this.conversations.listByTenant(tenantId, options);
  }

  async getConversation(
    tenantId: string,
    id: string,
  ): Promise<ConversationRecord> {
    const conversation = await this.conversations.findById(tenantId, id);
    if (!conversation) {
      throw new NotFoundError("not_found", "Conversación no encontrada");
    }
    return conversation;
  }

  async listMessages(
    tenantId: string,
    conversationId: string,
    options: ListMessagesOptions,
  ): Promise<ConversationPage<MessageRecord>> {
    await this.getConversation(tenantId, conversationId);
    return this.conversations.listMessages(tenantId, conversationId, options);
  }

  /**
   * Runs de LLM de una conversación (F3-3b). Verifica que la conversación
   * exista en el tenant (404 indistinguible de "no existe") antes de listar.
   */
  async listRuns(
    tenantId: string,
    conversationId: string,
    options: ListLlmRunsOptions,
  ): Promise<ConversationPage<LlmRunRecord>> {
    await this.getConversation(tenantId, conversationId);
    return this.runs.listByConversation(tenantId, conversationId, options);
  }

  /**
   * Envía un mensaje de texto del agente al cliente (M8) y lo persiste como
   * `OUTBOUND`. El estado de la conversación no cambia (el traspaso a humano es
   * F6-3): enviar no es transicionar.
   *
   * Orden deliberado: primero Meta (vía el proveedor del driver), luego BD. Si
   * Meta rechaza el envío no se persiste nada (502); si la persistencia falla
   * tras un send exitoso, el reintento del cliente podría duplicar en Meta (deuda
   * documentada: sin clave de idempotencia cliente en M8).
   */
  async sendMessage(input: SendMessageInput): Promise<MessageRecord> {
    const conversation = await this.getConversation(input.tenantId, input.conversationId);

    const account = await this.accounts.findById(input.tenantId, conversation.accountId);
    if (!account) {
      // Indistinguible de "no existe": la conversación apunta a una cuenta
      // desactivada o ajena, y no se revela cuál.
      throw new NotFoundError("not_found", "Conversación no encontrada");
    }

    let sent;
    try {
      sent = await this.whatsapp.sendTextMessage({
        phoneNumberId: account.phoneNumberId,
        accessToken: account.accessToken,
        to: conversation.customerWaId,
        text: input.text,
      });
    } catch (error) {
      // Token muerto (190/401): avisar marcando la cuenta; el próximo envío
      // caerá como no-existente y la renovación programada la re-firmará.
      if (error instanceof WhatsAppTokenExpiredError) {
        try {
          await this.accounts.markTokenExpired(account.id);
        } catch {
          // Best-effort: si la anotación falla no se debe ocultar el 502 real.
        }
      }
      throw error;
    }

    const message = await this.conversations.recordOutboundMessage(
      { tenantId: input.tenantId, conversationId: conversation.id },
      { providerMessageId: sent.providerMessageId, content: input.text },
    );

    await this.events.publish({
      event: "conversation.changed",
      tenantId: input.tenantId,
      conversationId: conversation.id,
    });

    return message;
  }
}