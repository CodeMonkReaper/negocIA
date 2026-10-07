/**
 * Puerto del proveedor de WhatsApp (M8, envío real de mensajes).
 *
 * El canal de salida: la capa de aplicación pide "manda este texto al cliente"
 * sin saber si detrás hay Meta Cloud API o el mock de tests
 * (dependency-rules.md §2 — Application depende de puertos, no de SDKs).
 *
 * El proveedor devuelve el `provider_message_id` (el `wamid` que genera Meta),
 * que es la frontera de idempotencia de `messages.provider_message_id`.
 */

export interface SendTextMessageInput {
  /** `phone_number_id` del WABA dentro de Meta (`whatsapp_accounts.phoneNumberId`). */
  phoneNumberId: string;
  /** Token de acceso del WABA (del alta manual; nunca se expone por HTTP). */
  accessToken: string;
  /** `wa_id` del cliente en Meta (`conversations.customerWaId`). */
  to: string;
  text: string;
}

export interface SendTextMessageResult {
  /** Id del mensaje para Meta (p. ej. `wamid.HBg…`); UNIQUE en `messages`. */
  providerMessageId: string;
}

export interface WhatsappProvider {
  sendTextMessage(input: SendTextMessageInput): Promise<SendTextMessageResult>;
}