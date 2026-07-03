# DB Migration: Phase 7 CRM Schema Expansion (2026-07-03)

## 1. Overview

This documents the "expand" step of a Phase 7 expand-contract schema migration, applied on 2026-07-03. No existing columns were dropped or renamed; all changes are backward compatible (new nullable columns / columns with defaults, plus new indexes).

## 2. Migrations

### `20260703052839_expand_customer`

**SQL**

```sql
ALTER TABLE "customers"
  ADD COLUMN "risk_score" DOUBLE PRECISION DEFAULT 0.5,
  ADD COLUMN "segment" TEXT DEFAULT 'UNCLASSIFIED';

ALTER TABLE "deal_registrations"
  ALTER COLUMN "updated_at" DROP DEFAULT;
```

Adds to `customers`: `segment` (TEXT, default `'UNCLASSIFIED'`), `risk_score` (DOUBLE PRECISION, default `0.5`).

**Purpose:** customer segmentation and risk scoring for the Phase 7 CRM expansion.

**Side note:** this migration also drops the DEFAULT on `deal_registrations.updated_at`. This reconciles pre-existing drift: schema.prisma only ever declared `@updatedAt` (Prisma-managed, no SQL default) for this column, but an earlier hand-written migration (`20260630300000`) had added a DEFAULT at the SQL level. Because only the Prisma client writes to this column (never raw SQL relying on the DB-level default), removing the stray DEFAULT is harmless and simply brings the database back in line with the schema declaration.

### `20260703053003_expand_opportunity`

**SQL**

```sql
ALTER TABLE "opportunities"
  ADD COLUMN "probability_override" DOUBLE PRECISION,
  ADD COLUMN "stage_entered_at" TIMESTAMP(3);
```

Adds to `opportunities`: `stage_entered_at` (TIMESTAMP(3), nullable), `probability_override` (DOUBLE PRECISION, nullable, **no default** — `null` means no manual override is set).

**Purpose:** track when an opportunity entered its current stage, and allow a manual override of computed win probability.

### `20260703053038_add_composite_indexes`

**SQL**

```sql
CREATE INDEX "customers_segment_risk_score_idx" ON "customers"("segment", "risk_score");
CREATE INDEX "opportunities_customer_id_stage_idx" ON "opportunities"("customer_id", "stage");
CREATE INDEX "opportunities_stage_stage_entered_at_idx" ON "opportunities"("stage", "stage_entered_at");
```

Adds composite indexes:

- `customers(segment, risk_score)`
- `opportunities(customer_id, stage)`
- `opportunities(stage, stage_entered_at)`

**Purpose:** support common query patterns filtering/sorting by the new segmentation and stage-timing fields.

## 3. Skipped from original plan

The original plan included work on a `mail_domain` table, but this was skipped because no such table exists in the schema — mail domain classification status is instead already tracked via `MailDerivedCandidate.status`.

## 4. Backfill

**Run the script:**

```bash
cd packages/db && npx tsx prisma/scripts/backfill-migrations.ts
```

**Idempotency:** `backfillCustomer()` only updates customer rows where `segment IS NULL OR riskScore IS NULL` (setting them to `'UNCLASSIFIED'` / `0.5`); `backfillOpportunityStageEnteredAt()` only updates opportunities where `stageEnteredAt IS NULL`. Re-running the script after it has already backfilled all rows is a no-op.

**`stageEnteredAt` source rule:** for each opportunity with `stageEnteredAt IS NULL`, look up the most recent `OpportunityStageEvent` where `toStage` equals the opportunity's current `stage` (ordered by `createdAt desc`); if such an event exists, use its `createdAt`, otherwise fall back to `opportunity.createdAt`.

**Seed data:** `pnpm db:seed` (packages/db/prisma/seed.ts) already populates `segment` and `riskScore` for demo customers (e.g. `segment: "SMB"`, `riskScore: 0.3`), so freshly seeded environments do not need the backfill script.

## 5. Deploy / Rollback

**Deploy:** CI applies migrations via `prisma migrate deploy` (see `.github/workflows/ci.yml`).

**Rollback:** because this migration set is expand-only (new nullable columns / columns with safe defaults, plus new indexes — nothing removed or renamed), there is no destructive state to undo. If a rollback is still needed, use `prisma migrate resolve --rolled-back <migration-name>` followed by a manual `ALTER TABLE ... DROP COLUMN` — but since the changes are backward compatible, a forward fix (i.e., a new migration correcting the issue) is recommended over a rollback.

The "contract" step of expand-contract (removing the old/superseded columns) is deferred to a future sprint and is out of scope for this document.
