export const LLM_RUN_STATUSES = ["RUNNING", "SUCCEEDED", "FAILED", "SKIPPED"] as const;
export type LlmRunStatus = (typeof LLM_RUN_STATUSES)[number];

export interface LlmRunRecord {
  id: string;
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
  outboundMessageId: string | null;
  requestId: string;
  status: LlmRunStatus;
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
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface StartLlmRunDraft {
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
  requestId: string;
  driver: string;
  requestedModel: string;
}

export interface CompleteLlmRunDraft {
  status: Exclude<LlmRunStatus, "RUNNING" | "SKIPPED">;
  resolvedModel: string | null;
  finishReason: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  toolCalls: number;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  outboundMessageId?: string | null;
}
