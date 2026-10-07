import type { WhatsappAccountRecord } from "../whatsapp/entities";

export interface CreateWhatsappAccountInput {
  /**
   * Opcional: los tests inyectan id propio; producción deja que la BD lo
   * genere con `gen_random_uuid()`.
   */
  id?: string;
  tenantId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhone?: string | null;
  accessToken: string;
  /** Vencimiento del token dado por Meta (`now + expires_in`). */
  tokenExpiresAt?: Date | null;
}

export interface UpdateWhatsappAccountInput {
  id: string;
  tenantId: string;
  accessToken: string;
  /** Nuevo vencimiento tras renovar/re-firmar; NULL = desconocido. */
  tokenExpiresAt?: Date | null;
}

/**
 * Repositorio de cuentas de WhatsApp conectadas (tenant-scoped).
 *
 * El webhook resuelve el tenant a partir de `phone_number_id` (viene en el
 * `metadata` del payload de Meta): si el número no está registrado, el evento
 * se ignora (204) en vez de guardarse huérfano.
 */
export interface WhatsappAccountRepository {
  findByPhoneNumberId(phoneNumberId: string): Promise<WhatsappAccountRecord | null>;
  /**
   * Resuelve la cuenta por tenant (M8): el envío de un mensaje de fuera necesita
   * el `access_token`/`phone_number_id` de la cuenta asociada a la conversación.
   */
  findById(tenantId: string, id: string): Promise<WhatsappAccountRecord | null>;
  listByTenant(tenantId: string): Promise<WhatsappAccountRecord[]>;
  /**
   * Cuentas cuyo token vence en o antes de `date` (o cuya expiración se
   * desconoce, `token_expires_at IS NULL`) y no están desactivadas: son las
   * candidatas a renovación por `fb_exchange_token`.
   */
  findExpiringBefore(date: Date): Promise<WhatsappAccountRecord[]>;
  create(input: CreateWhatsappAccountInput): Promise<WhatsappAccountRecord>;
  updateAccessToken(input: UpdateWhatsappAccountInput): Promise<WhatsappAccountRecord>;
  /** Marca la cuenta con token vencido (error 190/401 detectado en un envío). */
  markTokenExpired(id: string): Promise<void>;
}