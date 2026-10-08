import type { ConversationStatusResponseDto } from "@negocia/contracts";
import type {
  ConversationRecord,
  MessageRecord,
} from "../../../domain/conversations/entities";
import type { LlmRunRecord } from "../../../domain/llm/entities";

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

export interface LlmRunResponseDto {
  id: string;
  conversationId: string;
  requestId: string;
  status: string;
  driver: string;
  requestedModel: string;
  resolvedModel: string | null;
  finishReason: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  toolCalls: number;
  attempts: number;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
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

export function toLlmRunResponseDto(run: LlmRunRecord): LlmRunResponseDto {
  return {
    id: run.id,
    conversationId: run.conversationId,
    requestId: run.requestId,
    status: run.status,
    driver: run.driver,
    requestedModel: run.requestedModel,
    resolvedModel: run.resolvedModel,
    finishReason: run.finishReason,
    promptTokens: run.promptTokens,
    completionTokens: run.completionTokens,
    totalTokens: run.totalTokens,
    toolCalls: run.toolCalls,
    attempts: run.attempts,
    latencyMs: run.latencyMs,
    errorCode: run.errorCode,
    errorMessage: run.errorMessage,
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export function toConversationStatusResponseDto(
  conversation: ConversationRecord,
): ConversationStatusResponseDto {
  return {
    id: conversation.id,
    status: conversation.status,
    updatedAt: conversation.updatedAt.toISOString(),
  };
}