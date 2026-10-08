/**
 * Contratos de wire para WhatsApp (M8).
 *
 * Tipos de respuesta que el frontend necesita para consumir la API.
 * Los DTOs de entrada (con class-validator) viven en apps/api.
 */

export interface WhatsappAccountResponseDto {
  id: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhone: string | null;
  status: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
}

export interface EmbeddedSignupUrlResponseDto {
  url: string;
  state: string;
}

export interface WhatsappTemplateResponseDto {
  id: string;
  templateId: string;
  name: string;
  language: string;
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED";
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  components: unknown;
  syncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationResponseDto {
  id: string;
  accountId: string;
  customerWaId: string;
  customerName: string | null;
  status: "BOT_ACTIVE" | "HUMAN_REQUESTED" | "HUMAN_ACTIVE" | "CLOSED";
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ConversationStatus = ConversationResponseDto["status"];

export interface MessageResponseDto {
  id: string;
  conversationId: string;
  providerMessageId: string;
  direction: "INBOUND" | "OUTBOUND";
  type: string;
  content: string | null;
  deliveryStatus: string | null;
  createdAt: string;
  updatedAt: string;
}
export const CONVERSATION_ACTIONS = [
  "TAKE",
  "RETURN_TO_BOT",
] as const;
export type ConversationAction = (typeof CONVERSATION_ACTIONS)[number];
export interface TransitionConversationDto {
  action: ConversationAction;
}

export interface ConversationStatusResponseDto {
  id: string;
  status: ConversationStatus;
  updatedAt: string;
}
