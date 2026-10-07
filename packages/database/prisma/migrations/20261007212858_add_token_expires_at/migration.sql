-- DropForeignKey
ALTER TABLE "llm_runs" DROP CONSTRAINT "llm_runs_conversation_id_fkey";

-- DropForeignKey
ALTER TABLE "llm_runs" DROP CONSTRAINT "llm_runs_inbound_message_id_fkey";

-- DropForeignKey
ALTER TABLE "llm_runs" DROP CONSTRAINT "llm_runs_outbound_message_id_fkey";

-- DropForeignKey
ALTER TABLE "llm_runs" DROP CONSTRAINT "llm_runs_tenant_id_fkey";

-- AlterTable
ALTER TABLE "llm_runs" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "whatsapp_accounts" ADD COLUMN     "token_expires_at" TIMESTAMPTZ(6),
ADD COLUMN     "token_refreshed_at" TIMESTAMPTZ(6);

-- AddForeignKey
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_inbound_message_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "messages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_runs" ADD CONSTRAINT "llm_runs_outbound_message_id_fkey" FOREIGN KEY ("outbound_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "llm_runs_conversation_created_at_idx" RENAME TO "llm_runs_conversation_id_created_at_idx";

-- RenameIndex
ALTER INDEX "llm_runs_tenant_created_at_idx" RENAME TO "llm_runs_tenant_id_created_at_idx";
