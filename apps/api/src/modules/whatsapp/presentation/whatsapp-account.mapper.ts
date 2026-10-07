import type { WhatsappAccountRecord } from "../../../domain/whatsapp/entities";

/**
 * DTO de respuesta de una cuenta de WhatsApp.
 *
 * Se omite `accessToken` de forma deliberada: una cuenta conectada no vuelve a
 * mostrar su token, ni en listados ni tras el alta.
 */
export interface WhatsappAccountResponseDto {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export function toWhatsappAccountResponseDto(
  account: WhatsappAccountRecord,
): WhatsappAccountResponseDto {
  return {
    id: account.id,
    wabaId: account.wabaId,
    phoneNumberId: account.phoneNumberId,
    displayPhone: account.displayPhone,
    status: account.status,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}