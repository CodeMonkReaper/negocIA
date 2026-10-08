-- CreateTable
CREATE TABLE "products" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "price" DECIMAL(12, 2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CLP',
  "type" TEXT NOT NULL DEFAULT 'PRODUCT',
  "category" TEXT,
  "duration_minutes" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
  CONSTRAINT "products_type_check" CHECK ("type" IN ('PRODUCT', 'SERVICE')),
  CONSTRAINT "products_status_check" CHECK ("status" IN ('ACTIVE', 'INACTIVE')),
  CONSTRAINT "products_price_check" CHECK ("price" >= 0),
  CONSTRAINT "products_duration_check" CHECK ("duration_minutes" IS NULL OR "duration_minutes" > 0),
  CONSTRAINT "products_name_check" CHECK (length(trim("name")) > 0)
);

CREATE INDEX "products_tenant_status_idx" ON "products" ("tenant_id", "status");
CREATE INDEX "products_tenant_name_idx" ON "products" ("tenant_id", "name");
COMMENT ON TABLE "products" IS 'Catálogo de productos y servicios del tenant para ventas y agenda.';

