/**
 * Entidades de conversaciones y mensajes del canal (F2-4).
 *
 * Ver `docs/database/schema.md` §11 (tablas `conversations`/`messages`) y
 * `docs/legacy/project-context-diseno-original.md` §11/#12/#20.
 */

export const CONVERSATION_STATUSES = [
  "BOT_ACTIVE",
  "HUMAN_REQUESTED",
  "HUMAN_ACTIVE",
  "CLOSED",
] as const;

export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const MESSAGE_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;

export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

/** Statuses que reporta Meta en `statuses[].status` (docs §11 CHECK). */
export const DELIVERY_STATUSES = [
  "accepted",
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "deleted",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return (
    typeof value === "string" &&
    (DELIVERY_STATUSES as readonly string[]).includes(value)
  );
}

/** Fila persistida de `conversations` (F2-4; el mapeo a http vive en Presentation). */
export interface ConversationRecord {
  id: string;
  tenantId: string;
  accountId: string;
  /** `wa_id` del cliente en Meta; el id interno de contacto llega en F6. */
  customerWaId: string;
  customerName: string | null;
  status: ConversationStatus;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Fila persistida de `messages`. `direction` y `deliveryStatus` por CHECK. */
export interface MessageRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  /** `wamid` de Meta; UNIQUE global (frontera de idempotencia en escritura). */
  providerMessageId: string;
  direction: MessageDirection;
  /** Tipo reportado por Meta (`text`, `image`, …). */
  type: string;
  content: string | null;
  deliveryStatus: DeliveryStatus | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}

/** Mensaje entrante extraído del payload crudo de Meta (ver `meta-message.mapper`). */
export interface InboundMessageDraft {
  providerMessageId: string;
  customerWaId: string;
  customerName: string | null;
  type: string;
  content: string | null;
  /** Epoch en segundos que envía Meta. */
  timestamp: string;
  metadata: unknown;
}

/** Actualización de estado de entrega reportada por Meta (`statuses[]`). */
export interface DeliveryStatusUpdate {
  providerMessageId: string;
  deliveryStatus: DeliveryStatus;
}

/** Mensaje de salida enviado por el agente (M8, `Direction OUTBOUND`). */
export interface OutboundMessageDraft {
  /** `wamid` devuelto por Meta tras un send exitoso (UNIQUE global). */
  providerMessageId: string;
  content: string;
  /** Tipo reportado al persistir; por defecto `text`. */
  type?: string;
}