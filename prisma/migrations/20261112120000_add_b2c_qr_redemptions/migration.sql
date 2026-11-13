BEGIN;

CREATE TABLE "store_visits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "store_visits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sale_redemptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "redeemedByCustomerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "store_visits_tenantId_id_key" ON "store_visits"("tenantId", "id");
CREATE INDEX "store_visits_tenantId_customerId_createdAt_idx" ON "store_visits"("tenantId", "customerId", "createdAt");
CREATE UNIQUE INDEX "sale_redemptions_tenantId_id_key" ON "sale_redemptions"("tenantId", "id");
CREATE UNIQUE INDEX "sale_redemptions_tenantId_transactionId_key" ON "sale_redemptions"("tenantId", "transactionId");
CREATE INDEX "sale_redemptions_tenantId_expiresAt_redeemedAt_idx" ON "sale_redemptions"("tenantId", "expiresAt", "redeemedAt");

ALTER TABLE "store_visits" ADD CONSTRAINT "store_visits_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_visits" ADD CONSTRAINT "store_visits_tenantId_customerId_fkey"
    FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "sale_redemptions" ADD CONSTRAINT "sale_redemptions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_redemptions" ADD CONSTRAINT "sale_redemptions_tenantId_transactionId_fkey"
    FOREIGN KEY ("tenantId", "transactionId") REFERENCES "transactions"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "sale_redemptions" ADD CONSTRAINT "sale_redemptions_tenantId_redeemedByCustomerId_fkey"
    FOREIGN KEY ("tenantId", "redeemedByCustomerId") REFERENCES "customers"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT;
