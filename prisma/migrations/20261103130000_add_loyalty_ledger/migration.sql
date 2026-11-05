BEGIN;

ALTER TABLE "customer_missions" DROP CONSTRAINT "customer_missions_customerId_fkey";
ALTER TABLE "customer_missions" DROP CONSTRAINT "customer_missions_missionId_fkey";
ALTER TABLE "customer_missions"
    ADD COLUMN "tenantId" TEXT,
    ADD COLUMN "visits" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "lastVisitAt" TIMESTAMP(3);

UPDATE "customer_missions" AS progress
SET "tenantId" = customer."tenantId"
FROM "customers" AS customer
WHERE customer."id" = progress."customerId";

-- Invalid cross-tenant links or duplicate enrollments abort the migration intact.
ALTER TABLE "customer_missions" ALTER COLUMN "tenantId" SET NOT NULL;
ALTER TABLE "customer_missions" ADD CONSTRAINT "customer_missions_visits_check" CHECK ("visits" >= 0);
CREATE UNIQUE INDEX "missions_tenantId_id_key" ON "missions"("tenantId", "id");
CREATE UNIQUE INDEX "customer_missions_tenantId_customerId_missionId_key"
    ON "customer_missions"("tenantId", "customerId", "missionId");
CREATE INDEX "customer_missions_tenantId_missionId_idx" ON "customer_missions"("tenantId", "missionId");
ALTER TABLE "customer_missions" ADD CONSTRAINT "customer_missions_tenantId_customerId_fkey"
    FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "customer_missions" ADD CONSTRAINT "customer_missions_tenantId_missionId_fkey"
    FOREIGN KEY ("tenantId", "missionId") REFERENCES "missions"("tenantId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "outbox_events"
    ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "lastError" TEXT;
CREATE UNIQUE INDEX "outbox_events_tenantId_id_key" ON "outbox_events"("tenantId", "id");
CREATE INDEX "outbox_events_tenantId_processedAt_nextAttemptAt_createdAt_idx"
    ON "outbox_events"("tenantId", "processedAt", "nextAttemptAt", "createdAt");
CREATE INDEX "transactions_tenantId_customerId_type_createdAt_id_idx"
    ON "transactions"("tenantId", "customerId", "type", "createdAt", "id");

CREATE TABLE "points_ledger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "visitCounted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "points_ledger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "points_ledger_points_check" CHECK ("points" >= 0),
    CONSTRAINT "points_ledger_balanceAfter_check" CHECK ("balanceAfter" >= 0)
);

CREATE UNIQUE INDEX "points_ledger_tenantId_transactionId_key" ON "points_ledger"("tenantId", "transactionId");
CREATE UNIQUE INDEX "points_ledger_tenantId_eventId_key" ON "points_ledger"("tenantId", "eventId");
CREATE INDEX "points_ledger_tenantId_customerId_createdAt_idx" ON "points_ledger"("tenantId", "customerId", "createdAt");
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_tenantId_customerId_fkey"
    FOREIGN KEY ("tenantId", "customerId") REFERENCES "customers"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_tenantId_transactionId_fkey"
    FOREIGN KEY ("tenantId", "transactionId") REFERENCES "transactions"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "points_ledger" ADD CONSTRAINT "points_ledger_tenantId_eventId_fkey"
    FOREIGN KEY ("tenantId", "eventId") REFERENCES "outbox_events"("tenantId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE FUNCTION "protect_points_ledger"() RETURNS TRIGGER AS $$
DECLARE
    tenant_exists BOOLEAN;
BEGIN
    -- Preserve the existing full-tenant deletion lifecycle, but prohibit individual edits/deletes.
    IF TG_OP = 'DELETE' THEN
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.tenants WHERE id = $1)', TG_TABLE_SCHEMA)
            INTO tenant_exists USING OLD."tenantId";
        IF NOT tenant_exists THEN
            RETURN OLD;
        END IF;
    END IF;
    RAISE EXCEPTION 'Points ledger entries are immutable' USING ERRCODE = '23000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "points_ledger_immutable"
    BEFORE UPDATE OR DELETE ON "points_ledger"
    FOR EACH ROW EXECUTE FUNCTION "protect_points_ledger"();

COMMIT;
