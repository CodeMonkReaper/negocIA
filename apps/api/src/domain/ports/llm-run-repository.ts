import type { CompleteLlmRunDraft, LlmRunRecord, StartLlmRunDraft } from "../llm/entities";
import type { ConversationPage } from "./conversation-repository";

export interface ListLlmRunsOptions {
  limit: number;
  offset: number;
}

export interface LlmRunRepository {
  start(draft: StartLlmRunDraft): Promise<LlmRunRecord | "duplicated">;
  findByRequestId(tenantId: string, requestId: string): Promise<LlmRunRecord | null>;
  markSucceeded(tenantId: string, requestId: string, draft: CompleteLlmRunDraft): Promise<LlmRunRecord | null>;
  markFailed(tenantId: string, requestId: string, draft: CompleteLlmRunDraft): Promise<LlmRunRecord | null>;
  markSkipped(tenantId: string, requestId: string): Promise<LlmRunRecord | null>;
  /**
   * Página de runs de una conversación, en orden cronológico (desc).
   * El filtro por tenant garantiza que un `conversationId` ajeno devuelva
   * página vacía, nunca filas de otro tenant.
   */
  listByConversation(
    tenantId: string,
    conversationId: string,
    options: ListLlmRunsOptions,
  ): Promise<ConversationPage<LlmRunRecord>>;
}