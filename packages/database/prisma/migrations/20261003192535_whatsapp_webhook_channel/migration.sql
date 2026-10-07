-- CreateTable
CREATE TABLE "whatsapp_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "waba_id" TEXT NOT NULL,
    "phone_number_id" TEXT NOT NULL,
    "display_phone" TEXT,
    "access_token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "whatsapp_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_event_id" TEXT NOT NULL,
    "tenant_id" UUID,
    "account_id" UUID,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(6),

    CONSTRAINT "whatsapp_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "whatsapp_accounts_tenant_id_idx" ON "whatsapp_accounts"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_tenant_id_waba_id_key" ON "whatsapp_accounts"("tenant_id", "waba_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_accounts_tenant_id_phone_number_id_key" ON "whatsapp_accounts"("tenant_id", "phone_number_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_events_provider_event_id_key" ON "whatsapp_events"("provider_event_id");

-- CreateIndex
CREATE INDEX "whatsapp_events_tenant_id_idx" ON "whatsapp_events"("tenant_id");

-- CreateIndex
CREATE INDEX "whatsapp_events_account_id_idx" ON "whatsapp_events"("account_id");

-- CreateIndex
CREATE INDEX "whatsapp_events_status_created_at_idx" ON "whatsapp_events"("status", "created_at");

-- AddForeignKey
ALTER TABLE "whatsapp_accounts" ADD CONSTRAINT "whatsapp_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_events" ADD CONSTRAINT "whatsapp_events_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_events" ADD CONSTRAINT "whatsapp_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enums como TEXT + CHECK (convención del monorepo: evolucionar un status no
-- requiere ALTER TYPE).
ALTER TABLE "whatsapp_accounts"
    ADD CONSTRAINT "whatsapp_accounts_status_check"
    CHECK ("status" IN ('ACTIVE', 'DISABLED'));

ALTER TABLE "whatsapp_events"
    ADD CONSTRAINT "whatsapp_events_status_check"
    CHECK ("status" IN ('RECEIVED', 'ENQUEUED', 'PROCESSED', 'DEDUPLICATED', 'FAILED'));

-- La no-nulidad del provider_event_id ya la cubre el UNIQUE; este CHECK documenta
-- que el id de Meta nunca puede ser un string vacío.
ALTER TABLE "whatsapp_events"
    ADD CONSTRAINT "whatsapp_events_provider_event_id_not_blank"
    CHECK (length("provider_event_id") > 0);

COMMENT ON TABLE "whatsapp_accounts" IS
    'Cuenta de WhatsApp Business conectada (tenant-scoped). Alta manual o Embedded Signup (M8).';

COMMENT ON TABLE "whatsapp_events" IS
    'Evento crudo del webhook de Meta con idempotencia por provider_event_id (system-scoped).';
