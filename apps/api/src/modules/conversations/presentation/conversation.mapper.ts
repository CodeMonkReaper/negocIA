import type {
  ConversationRecord,
  MessageRecord,
} from "../../../domain/conversations/entities";

/**
 * Proyección explícita campo a campo: la fila no viaja por HTTP tal cual y
 * enumerar evita que un cambio futuro del `select` se cuele en la respuesta.
 */
export interface ConversationResponseDto {
  id: string;
  customerWaId: string;
  customerName: string | null;
  status: string;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageResponseDto {
  id: string;
  direction: string;
  type: string;
  content: string | null;
  deliveryStatus: string | null;
  createdAt: string;
}

export function toConversationResponseDto(
  conversation: ConversationRecord,
): ConversationResponseDto {
  return {
    id: conversation.id,
    customerWaId: conversation.customerWaId,
    customerName: conversation.customerName,
    status: conversation.status,
    lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };
}

export function toMessageResponseDto(message: MessageRecord): MessageResponseDto {
  return {
    id: message.id,
    direction: message.direction,
    type: message.type,
    content: message.content,
    deliveryStatus: message.deliveryStatus ?? null,
    createdAt: message.createdAt.toISOString(),
  };
}