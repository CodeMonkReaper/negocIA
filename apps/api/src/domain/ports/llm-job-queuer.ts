export interface LlmJobInput {
  tenantId: string;
  conversationId: string;
  inboundMessageId: string;
  requestId: string;
}

export interface LlmJobQueuer {
  enqueue(job: LlmJobInput): Promise<void>;
}
