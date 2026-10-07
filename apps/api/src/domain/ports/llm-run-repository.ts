import type { CompleteLlmRunDraft, LlmRunRecord, StartLlmRunDraft } from "../llm/entities";

export interface LlmRunRepository {
  start(draft: StartLlmRunDraft): Promise<LlmRunRecord | "duplicated">;
  findByRequestId(tenantId: string, requestId: string): Promise<LlmRunRecord | null>;
  markSucceeded(tenantId: string, requestId: string, draft: CompleteLlmRunDraft): Promise<LlmRunRecord | null>;
  markFailed(tenantId: string, requestId: string, draft: CompleteLlmRunDraft): Promise<LlmRunRecord | null>;
  markSkipped(tenantId: string, requestId: string): Promise<LlmRunRecord | null>;
}
