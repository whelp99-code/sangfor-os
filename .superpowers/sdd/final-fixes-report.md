# Final Review Fixes Report

Date: 2026-06-30
Branch: feat-project-hub-phase3

## Status: COMPLETE

All 5 fixes applied. Typecheck (db, business, web) and business tests green. 4 DB indexes confirmed.

## Fixes Applied

### 1. Transaction boundaries — `packages/business/src/opportunity-center.ts`

- `createOpportunity`: wrapped `nextval` sequence read + `opportunity.create` + `opportunityStageEvent.create` in `prisma.$transaction`. `logStateTransition` remains outside (best-effort audit).
- `updateOpportunity`: when stage transitions, wraps `opportunity.update` + `opportunityStageEvent.create` in `prisma.$transaction`. `logStateTransition` remains outside.
- Extracted `newStage` variable to satisfy TypeScript narrowing inside async callback.

### 2. partnerTierMargin range validation

- `apps/web/src/app/api/opportunities/[id]/registration/route.ts`: updated Zod schema to `z.number().min(0).max(100).nullable().optional()`.
- `packages/business/src/deal-registration.ts`: added guard at top of `upsertDealRegistration` that throws `Error("partnerTierMargin must be between 0 and 100")` for out-of-range values.

### 3. Additive index migration

- Created `packages/db/prisma/migrations/20260630400000_review_indexes/migration.sql` with 4 `CREATE INDEX IF NOT EXISTS` statements.
- Added `@@index([economicBuyerId])` and `@@index([championId])` to `DealQualification` in `packages/db/prisma/schema.prisma`.
- Added `@@index([ownerId])` and `@@index([dealStatus])` to `Opportunity` in `packages/db/prisma/schema.prisma`.
- Applied migration SQL to DB; registered in `_prisma_migrations`.
- Ran `pnpm --filter @sangfor/db db:generate` to regenerate Prisma client.

### 4. Distributor kind filter — `apps/web/src/app/(portal)/deals/[id]/page.tsx`

- `distributorOptions` now filters to `p.kind === "DISTRIBUTOR" || p.kind == null` before mapping.
- `listPartners` returns all model fields (no `select`), so `kind` is present at runtime.

### 5. probability field comment

- Added one-line JSDoc comment above `probability` in `updateOpportunitySchema` documenting it as a manual forecast field (intentionally writable).

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm --filter @sangfor/db typecheck` | PASS |
| `pnpm --filter @sangfor/business typecheck` | PASS |
| `pnpm --filter @sangfor/web typecheck` | PASS |
| `pnpm --filter @sangfor/business test` | PASS (350 passed, 47 skipped) |
| DB: `deal_qualifications_economic_buyer_id_idx` | CONFIRMED |
| DB: `deal_qualifications_champion_id_idx` | CONFIRMED |
| DB: `opportunities_owner_id_idx` | CONFIRMED |
| DB: `opportunities_deal_status_idx` | CONFIRMED |

## Files Changed

- `packages/business/src/opportunity-center.ts`
- `packages/business/src/deal-registration.ts`
- `apps/web/src/app/api/opportunities/[id]/registration/route.ts`
- `apps/web/src/app/(portal)/deals/[id]/page.tsx`
- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260630400000_review_indexes/migration.sql` (new)
