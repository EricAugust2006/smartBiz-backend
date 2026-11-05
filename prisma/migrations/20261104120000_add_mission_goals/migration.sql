BEGIN;

CREATE TYPE "GoalType" AS ENUM ('VISITS', 'AMOUNT');

-- Older missions were handled as visit challenges by the existing loyalty engine.
ALTER TABLE "missions"
    ADD COLUMN "goalType" "GoalType" NOT NULL DEFAULT 'VISITS',
    ALTER COLUMN "description" DROP NOT NULL,
    ALTER COLUMN "expiresAt" DROP NOT NULL;

-- Supports an explicitly prepared backfill without inventing legacy targets.
ALTER TABLE "missions" ADD COLUMN IF NOT EXISTS "targetValue" DECIMAL(12,2);
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "missions" WHERE "targetValue" IS NULL) THEN
        RAISE EXCEPTION 'Existing missions need explicit targetValue values before this migration. Add a nullable DECIMAL(12,2) targetValue column and fill each mission target by tenantId/id, then rerun the migration.';
    END IF;
END;
$$;

ALTER TABLE "missions"
    ALTER COLUMN "goalType" DROP DEFAULT,
    ALTER COLUMN "targetValue" SET NOT NULL,
    ADD CONSTRAINT "missions_targetValue_positive_check"
        CHECK ("targetValue" > 0 AND "targetValue" <> 'NaN'::numeric),
    ADD CONSTRAINT "missions_visits_integer_check"
        CHECK ("goalType" <> 'VISITS' OR "targetValue" = trunc("targetValue"));

CREATE INDEX "missions_tenantId_createdAt_id_idx" ON "missions"("tenantId", "createdAt", "id");

COMMIT;
