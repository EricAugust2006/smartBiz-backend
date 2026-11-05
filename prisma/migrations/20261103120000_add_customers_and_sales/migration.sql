BEGIN;

ALTER TABLE "transactions" DROP CONSTRAINT "transactions_customerId_fkey";

ALTER TABLE "customers" ADD COLUMN "cpf" TEXT;

-- Preserve legacy transactions; new sales always supply the staff and request key.
-- Existing Float amounts are rounded to the currency's two decimal places.
ALTER TABLE "transactions"
    ADD COLUMN "createdById" TEXT,
    ADD COLUMN "idempotencyKey" TEXT,
    ADD COLUMN "requestHash" TEXT,
    ALTER COLUMN "amount" TYPE DECIMAL(12,2) USING ROUND("amount"::numeric, 2);

CREATE TABLE "transaction_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "transaction_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "transaction_items_quantity_check" CHECK ("quantity" > 0),
    CONSTRAINT "transaction_items_unitPrice_check" CHECK ("unitPrice" >= 0)
);

CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_tenantId_id_key" ON "users"("tenantId", "id");
CREATE UNIQUE INDEX "customers_tenantId_cpf_key" ON "customers"("tenantId", "cpf");
CREATE UNIQUE INDEX "customers_tenantId_id_key" ON "customers"("tenantId", "id");
CREATE UNIQUE INDEX "products_tenantId_id_key" ON "products"("tenantId", "id");
CREATE UNIQUE INDEX "transactions_tenantId_id_key" ON "transactions"("tenantId", "id");
CREATE UNIQUE INDEX "transactions_tenantId_idempotencyKey_key" ON "transactions"("tenantId", "idempotencyKey");
CREATE INDEX "transactions_tenantId_createdAt_idx" ON "transactions"("tenantId", "createdAt");
CREATE INDEX "transaction_items_tenantId_productId_idx" ON "transaction_items"("tenantId", "productId");
CREATE UNIQUE INDEX "transaction_items_tenantId_transactionId_productId_key" ON "transaction_items"("tenantId", "transactionId", "productId");
CREATE INDEX "outbox_events_tenantId_processedAt_createdAt_idx" ON "outbox_events"("tenantId", "processedAt", "createdAt");
CREATE UNIQUE INDEX "outbox_events_tenantId_transactionId_type_key" ON "outbox_events"("tenantId", "transactionId", "type");

ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenantId_customerId_fkey"
    FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenantId_createdById_fkey"
    FOREIGN KEY ("tenantId", "createdById") REFERENCES "users"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_tenantId_transactionId_fkey"
    FOREIGN KEY ("tenantId", "transactionId") REFERENCES "transactions"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_tenantId_productId_fkey"
    FOREIGN KEY ("tenantId", "productId") REFERENCES "products"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenantId_transactionId_fkey"
    FOREIGN KEY ("tenantId", "transactionId") REFERENCES "transactions"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT;
