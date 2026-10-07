/**
 * Entidades del canal Meta WhatsApp (F2-3).
 *
 * Ver `docs/database/schema.md` §10 y `docs/architecture/whatsapp.md`.
 */

/**
 * Estados de una cuenta de WhatsApp conectada:
 *  - `ACTIVE`: token vigente (o renovable); puede enviar y recibir.
 *  - `TOKEN_EXPIRED`: un envío o una renovación detectó token vencido (error
 *    190/401 de Graph); el job de renovación sigue intentándola (filtra por
 *    este estado también) y la devuelve a `ACTIVE` al renovar con éxito.
 *  - `DISABLED`: desactivada por la aplicación (baja manual); no se renueva.
 */
export const WHATSAPP_ACCOUNT_STATUSES = [
  "ACTIVE",
  "TOKEN_EXPIRED",
  "DISABLED",
] as const;

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
  /** Cuándo vence el access_token vigente; NULL = desconocido (candidata a re-firmar). */
  tokenExpiresAt: Date | null;
  /** Última renovación exitosa (fb_exchange_token o re-signup). */
  tokenRefreshedAt: Date | null;
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