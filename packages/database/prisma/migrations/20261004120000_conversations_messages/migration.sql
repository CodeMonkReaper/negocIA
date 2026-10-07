-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "customer_wa_id" TEXT NOT NULL,
    "customer_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'BOT_ACTIVE',
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT,
    "delivery_status" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_tenant_id_account_id_customer_wa_id_key"
    ON "conversations"("tenant_id", "account_id", "customer_wa_id");

-- CreateIndex
CREATE INDEX "conversations_tenant_id_status_last_message_at_idx"
    ON "conversations"("tenant_id", "status", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "messages_provider_message_id_key" ON "messages"("provider_message_id");

-- CreateIndex
CREATE INDEX "messages_tenant_id_idx" ON "messages"("tenant_id");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enums como TEXT + CHECK (convención del monorepo: evolucionar un status no
-- requiere ALTER TYPE). La máquina de estados completa se aplica en F6-3;
-- aquí el CHECK ya cubre los cuatro estados del diseño (legacy doc §11/#20).
ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_status_check"
    CHECK ("status" IN ('BOT_ACTIVE', 'HUMAN_REQUESTED', 'HUMAN_ACTIVE', 'CLOSED'));

ALTER TABLE "messages"
    ADD CONSTRAINT "messages_direction_check"
    CHECK ("direction" IN ('INBOUND', 'OUTBOUND'));

-- delivery_status replica los statuses que reporta Meta en statuses[].status.
ALTER TABLE "messages"
    ADD CONSTRAINT "messages_delivery_status_check"
    CHECK ("delivery_status" IN ('accepted', 'queued', 'sent', 'delivered', 'read', 'failed', 'deleted'));

-- La no-nulidad del provider_message_id ya la cubre el UNIQUE; este CHECK
-- documenta que el id de Meta nunca puede ser un string vacío.
ALTER TABLE "messages"
    ADD CONSTRAINT "messages_provider_message_id_not_blank"
    CHECK (length("provider_message_id") > 0);

COMMENT ON TABLE "conversations" IS
    'Conversación de canal por cliente (tenant-scoped). Una por tenant+cuenta+cliente.';

COMMENT ON TABLE "messages" IS
    'Mensaje del canal con idempotencia por provider_message_id (tenant-scoped).';