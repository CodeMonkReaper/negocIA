-- CreateTable
CREATE TABLE "llm_runs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "conversation_id" UUID NOT NULL,
  "inbound_message_id" UUID NOT NULL,
  "outbound_message_id" UUID,
  "request_id" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "driver" TEXT NOT NULL,
  "requested_model" TEXT NOT NULL,
  "resolved_model" TEXT,
  "finish_reason" TEXT,
  "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
  "completion_tokens" INTEGER NOT NULL DEFAULT 0,
  "total_tokens" INTEGER NOT NULL DEFAULT 0,
  "tool_calls" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "latency_ms" INTEGER,
  "error_code" TEXT,
  "error_message" TEXT,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "llm_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
  CONSTRAINT "llm_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE,
  CONSTRAINT "llm_runs_inbound_message_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "messages"("id") ON DELETE RESTRICT,
  CONSTRAINT "llm_runs_outbound_message_id_fkey" FOREIGN KEY ("outbound_message_id") REFERENCES "messages"("id") ON DELETE SET NULL,
  CONSTRAINT "llm_runs_status_check" CHECK ("status" IN ('RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  CONSTRAINT "llm_runs_finish_reason_check" CHECK ("finish_reason" IS NULL OR "finish_reason" IN ('stop','length','tool_calls','content_filter','error')),
  CONSTRAINT "llm_runs_tokens_check" CHECK ("prompt_tokens" >= 0 AND "completion_tokens" >= 0 AND "total_tokens" >= 0 AND "tool_calls" >= 0 AND "attempts" >= 1),
  CONSTRAINT "llm_runs_latency_check" CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0),
  CONSTRAINT "llm_runs_request_id_check" CHECK (length("request_id") > 0)
);

CREATE INDEX "llm_runs_tenant_created_at_idx" ON "llm_runs" ("tenant_id", "created_at");
CREATE INDEX "llm_runs_conversation_created_at_idx" ON "llm_runs" ("conversation_id", "created_at");
CREATE INDEX "llm_runs_status_created_at_idx" ON "llm_runs" ("status", "created_at");
COMMENT ON TABLE "llm_runs" IS 'Runs de LLM por conversación (idempotentes, tokens por tenant).';
