import { ExternalProviderError } from "../../domain/errors";
import { safeJsonParse } from "../../common/utils/json-parser";
import type {
  SendTextMessageInput,
  SendTextMessageResult,
  WhatsappProvider,
} from "../../domain/ports/whatsapp-provider";

export const META_GRAPH_API_VERSION = "v21.0";
export const META_MESSAGES_ENDPOINT = "https://graph.facebook.com";

interface MetaMessagesResponse {
  messaging_product?: string;
  contacts?: Array<{ input?: string; wa_id?: string }>;
  messages?: Array<{ id?: string }>;
}

interface MetaErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

function isMetaErrorResponse(body: unknown): body is MetaErrorResponse {
  return typeof body === "object" && body !== null && "error" in body;
}

function isMetaMessagesResponse(body: unknown): body is MetaMessagesResponse {
  return (
    typeof body === "object" &&
    body !== null &&
    "messages" in body &&
    Array.isArray((body as { messages?: unknown }).messages)
  );
}

/**
 * Adaptador real del canal de salida: WhatsApp Cloud API (M8).
 *
 * POST `https://graph.facebook.com/v21.0/{phone_number_id}/messages` con
 * `Bearer` token. Meta responde `{ messages: [{ id: "wamid.HBg…" }] }`; cualquier
 * error de Graph (token inválido, número fuera de ventana, WABA en sandbox…)
 * se traduce a `ExternalProviderError` (502, `external_provider_error`).
 */
export class MetaCloudProvider implements WhatsappProvider {
  constructor(
    private readonly baseUrl = `${META_MESSAGES_ENDPOINT}/${META_GRAPH_API_VERSION}`,
  ) {}

  async sendTextMessage(input: SendTextMessageInput): Promise<SendTextMessageResult> {
    const response = await fetch(`${this.baseUrl}/${input.phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "text",
        text: { preview_url: false, body: input.text },
      }),
    });

    const rawBody: unknown = await safeJsonParse(response);

    if (!response.ok) {
      throw this.toProviderError(rawBody);
    }

    if (!isMetaMessagesResponse(rawBody)) {
      throw new ExternalProviderError(
        "Meta respondió 200 sin el id del mensaje enviado",
        { status: response.status },
      );
    }

    const messages = rawBody.messages as Array<{ id?: string }>;
    const providerMessageId = messages[0]?.id;
    if (typeof providerMessageId !== "string" || providerMessageId.length === 0) {
      throw new ExternalProviderError(
        "Meta respondió 200 sin el id del mensaje enviado",
        { status: response.status },
      );
    }

    return { providerMessageId };
  }

  private toProviderError(body: unknown): ExternalProviderError {
    const error = isMetaErrorResponse(body) ? body.error : undefined;
    const message =
      typeof error?.message === "string" && error.message.length > 0
        ? error.message
        : "Meta rechazó el envío del mensaje";
    return new ExternalProviderError(message, {
      code: error?.code,
      errorSubcode: error?.error_subcode,
      type: error?.type,
    });
  }
}