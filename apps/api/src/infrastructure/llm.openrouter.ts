import { LlmError } from "../domain/errors";
import { safeJsonParse } from "../common/utils/json-parser";
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
  LlmToolCall,
  LlmToolDefinition,
  LlmUsage,
} from "../domain/ports";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** `finish_reason` normalizados que garantiza el proveedor. */
const FINISH_REASONS = {
  stop: "stop",
  length: "length",
  tool_calls: "tool_calls",
  content_filter: "content_filter",
  error: "error",
} as const satisfies Record<string, LlmCompletion["finishReason"]>;

export interface OpenRouterLlmAdapterOptions {
  apiKey: string;
  /** Slug del modelo pedido (`openai/gpt-4o-mini`). OpenRouter enruta al proveedor disponible. */
  model: string;
  /** Base de la API de chat, **con** path (`https://openrouter.ai/api/v1`). Se le añade
   * `/chat/completions`; la barra final se normaliza. Permite apuntar a un proxy propio. */
  baseUrl?: string;
  timeoutMs?: number;
  /** URL pública del producto (`HTTP-Referer`). Cosmética: solo ranking en openrouter.ai. */
  appUrl?: string;
  /** Nombre público del producto (`X-OpenRouter-Title`). Cosmético, igual que `appUrl`. */
  appTitle?: string;
}

interface OpenRouterToolCall {
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenRouterChoice {
  finish_reason?: string | null;
  message?: {
    content?: string | null;
    tool_calls?: OpenRouterToolCall[];
  };
}

/**
 * Forma de la respuesta 200.
 *
 * `choices` es **requerido** a propósito: el type guard de abajo comprueba
 * `Array.isArray(choices)`, así que declararlo opcional dejaría a TypeScript
 * creyendo que `choices` puede ser `undefined` justo después de estrechar.
 */
interface OpenRouterCompletionResponse {
  model?: string;
  choices: OpenRouterChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function isOpenRouterErrorResponse(body: unknown): body is { error?: { message?: string; code?: number | string } } {
  return typeof body === "object" && body !== null && "error" in body;
}

function isOpenRouterCompletionResponse(body: unknown): body is OpenRouterCompletionResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    "choices" in body &&
    Array.isArray((body as { choices?: unknown }).choices)
  );
}

function toFinishReason(raw: string | null | undefined): LlmCompletion["finishReason"] {
  // Un valor desconocido se degrada a "error" en vez de inventar un estado: quien
  // llama tiene que poder fiarse de que la unión de fin es la de este archivo.
  return typeof raw === "string" && raw in FINISH_REASONS
    ? FINISH_REASONS[raw as keyof typeof FINISH_REASONS]
    : "error";
}

function toToolCalls(raw: OpenRouterToolCall[] | undefined): LlmToolCall[] {
  return (raw ?? [])
    .filter((call) => typeof call.function?.name === "string" && call.function.name.length > 0)
    .map((call) => ({
      id: call.id ?? "",
      name: call.function?.name ?? "",
      // El modelo devuelve los argumentos como texto JSON. Si viene inválido se
      // entrega el texto crudo: `arguments` es `unknown`, así que el ejecutor de
      // tools tiene que resolverlo y no inventamos una forma falsa.
      arguments: parseToolArguments(call.function?.arguments),
    }));
}

function parseToolArguments(raw: string | undefined): unknown {
  if (typeof raw !== "string" || raw.length === 0) {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function toUsage(raw: OpenRouterCompletionResponse["usage"]): LlmUsage {
  const read = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const promptTokens = read(raw?.prompt_tokens);
  const completionTokens = read(raw?.completion_tokens);
  const totalTokens = read(raw?.total_tokens);
  return { promptTokens, completionTokens, totalTokens: totalTokens || promptTokens + completionTokens };
}


function toOpenRouterMessages(messages: import('../domain/ports/llm-provider').LlmMessage[]): unknown[] {
  return messages.map((m) => {
    const msg: Record<string, unknown> = { role: m.role, content: m.content };
    if (m.role === 'tool' && m.toolCallId) {
      msg.tool_call_id = m.toolCallId;
    }
    if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
      msg.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments) },
      }));
    }
    return msg;
  });
}

function toToolsPayload(tools: LlmToolDefinition[]): unknown[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

/**
 * Adaptador real del proveedor de IA: OpenRouter (F3-3).
 *
 * POST `${baseUrl}/chat/completions` con `Bearer` y cuerpo compatible con la API
 * de chat de OpenAI, que es el contrato estable de OpenRouter. Se usa **`fetch`
 * nativo** y no el SDK: cero dependencias nuevas, el mismo criterio que
 * `MetaCloudProvider`, y `baseUrl` inyectable para poder probar el payload sin
 * red.
 *
 * Solo modo no-streaming. El consumidor es un worker de cola que persiste la
 * respuesta completa; el streaming no aporta nada ahí y sí complica el manejo de
 * errores (un fallo a mitad de stream llega como evento SSE con HTTP 200).
 *
 * **No reintenta.** Los reintentos son de la cola (BullMQ), no de la capa HTTP:
 * reintentar aquí multiplicaría los cobros de OpenRouter sin saber si la
 * petición anterior llegó a consumirse.
 */
export class OpenRouterLlmAdapter implements LlmProvider {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly options: OpenRouterLlmAdapterOptions,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = (options.baseUrl ?? OPENROUTER_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const response = await this.post(request);
    const rawBody: unknown = await safeJsonParse(response);

    if (!response.ok) {
      throw toProviderError(response.status, rawBody);
    }
    if (!isOpenRouterCompletionResponse(rawBody)) {
      throw new LlmError("OpenRouter respondió 200 con un cuerpo inesperado", {
        status: response.status,
      });
    }

    const choice = rawBody.choices[0];
    if (!choice?.message) {
      throw new LlmError("OpenRouter respondió 200 sin una elección utilizable", {
        status: response.status,
        choices: rawBody.choices.length,
      });
    }

    const content = choice.message.content;
    return {
      text: typeof content === "string" && content.length > 0 ? content : null,
      toolCalls: toToolCalls(choice.message.tool_calls),
      finishReason: toFinishReason(choice.finish_reason),
      // Se registra el modelo que respondió, no el pedido: con alias y routing
      // son distintos, y es lo que permite atribuir el gasto después.
      model: typeof rawBody.model === "string" && rawBody.model.length > 0 ? rawBody.model : this.options.model,
      usage: toUsage(rawBody.usage),
    };
  }

  private async post(request: LlmCompletionRequest): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.options.apiKey}`,
    };
    if (this.options.appUrl) {
      headers["HTTP-Referer"] = this.options.appUrl;
    }
    if (this.options.appTitle) {
      headers["X-OpenRouter-Title"] = this.options.appTitle;
    }

    const payload: Record<string, unknown> = {
      model: this.options.model,
      messages: toOpenRouterMessages(request.messages),
      stream: false,
    };
    if (request.temperature !== undefined) {
      payload.temperature = request.temperature;
    }
    if (request.maxTokens !== undefined) {
      payload.max_tokens = request.maxTokens;
    }
    if (request.tools && request.tools.length > 0) {
      payload.tools = toToolsPayload(request.tools);
      // `tool_choice` solo tiene sentido con tools: mandarlo sin ellos es un 400.
      payload.tool_choice = request.toolChoice ?? "auto";
    }

    try {
      return await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw toTransportError(cause, this.timeoutMs);
    }
  }
}

function toProviderError(status: number, body: unknown): LlmError {
  const error = isOpenRouterErrorResponse(body) ? body.error : undefined;
  const details: Record<string, unknown> = { status };
  if (error?.code !== undefined) {
    details.providerCode = error.code;
  }

  if (status === 401) {
    return new LlmError("OpenRouter rechazó la API key", details);
  }
  if (status === 402) {
    // OpenRouter prepaga: 402 significa que la cuenta se quedó sin créditos. Es
    // la causa más probable de un fallo total en producción, así que merece un
    // mensaje propio en vez de "rechazó la petición".
    return new LlmError("OpenRouter se quedó sin créditos para completar la petición", details);
  }
  if (status === 429) {
    return new LlmError("OpenRouter aplicó rate limit a la petición", details);
  }
  return new LlmError("OpenRouter rechazó la petición", details);
}

function toTransportError(cause: unknown, timeoutMs: number): LlmError {
  const isTimeout =
    cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError");
  if (isTimeout) {
    return new LlmError(`OpenRouter no respondió dentro de ${timeoutMs} ms`, { timeoutMs });
  }
  return new LlmError("No se pudo contactar con OpenRouter", {
    reason: cause instanceof Error ? cause.name : "unknown",
  });
}
