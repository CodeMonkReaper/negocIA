/**
 * Contrato de wire para runs de LLM (F3-3b).
 *
 * `llm_runs` es la auditoría de actividad del agente por conversación:
 * idempotente por `request_id`, con tokens por tenant. El panel lo consume para
 * mostrar qué pasó con cada respuesta del bot (éxito, fallo, modelo usado…).
 */

export interface LlmRunResponseDto {
  id: string;
  conversationId: string;
  requestId: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";
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
  /** ISO 8601. `null` mientras el run no está completo. */
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}