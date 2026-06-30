-- CreateSequence
CREATE SEQUENCE IF NOT EXISTS opp_code_seq;

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN "code" text;

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_code_key" ON "opportunities"("code");

-- Backfill existing rows with PRJ-2026-NNNN codes
UPDATE "opportunities"
SET "code" = 'PRJ-2026-' || lpad(nextval('opp_code_seq')::text, 4, '0')
WHERE "code" IS NULL;
