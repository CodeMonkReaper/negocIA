/**
 * Entidades del canal Meta WhatsApp (F2-3).
 *
 * Ver `docs/database/schema.md` §10 y `docs/architecture/whatsapp.md`.
 */

export const WHATSAPP_ACCOUNT_STATUSES = ["ACTIVE", "DISABLED"] as const;

/** Estados del evento crudo recibido del webhook. */
export const WHATSAPP_EVENT_STATUSES = [
  "RECEIVED",
  "ENQUEUED",
  "PROCESSED",
  "DEDUPLICATED",
  "FAILED",
] as const;

export type WhatsappEventStatus = (typeof WHATSAPP_EVENT_STATUSES)[number];

export interface WhatsappAccountRecord {
  id: string;
  tenantId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string | null;
  accessToken: string;
  accessTokenEncrypted: {
    iv: string;
    ciphertext: string;
    tag: string;
  };
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WhatsappEventRecord {
  id: string;
  /** Id global de Meta (`wamid.*`, `statuses.id`, …); UNIQUE para idempotencia. */
  providerEventId: string;
  tenantId: string | null;
  accountId: string | null;
  eventType: string;
  payload: unknown;
  status: WhatsappEventStatus;
  createdAt: Date;
  processedAt: Date | null;
}

export interface CreateWhatsappEventDraft {
  providerEventId: string;
  tenantId: string | null;
  accountId: string | null;
  eventType: string;
  payload: unknown;
}