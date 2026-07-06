<!-- Parent: ../../AGENTS.md -->

# @sangfor/db — Prisma data layer

> The single Prisma client + schema for the whole platform (~150 models), plus row-level-security helpers and finance/CRM data scripts. A Tier-0 leaf: depends on no other `@sangfor/*` package.

## Constraints
- **Migrations are the system of record.** `prisma/migrations/` holds formal timestamped migrations; CI runs `db:migrate:deploy`. `db push --accept-data-loss` is BANNED.
- **Schema changes are additive/nullable.** Before editing `prisma/schema.prisma` run `git diff origin/main -- packages/db/prisma/schema.prisma`. Prefer `db:push:safe` (CFO-snapshots first) over raw push in dev.
- **One client only.** `src/index.ts` exports a global-cached singleton `prisma`; every consumer imports it. Never construct another client.
- Columns are snake_case via `@map`/`@@map`; ids are cuid; keep `created_at`/`updated_at` pairs. Multi-tenant + RLS by design — see `src/rls.ts` (`RLS_BASELINE_POLICIES`).

## Working Here
- Add a model → author a migration (`db:migrate` locally, or `migrate diff` + shadow DB) → verify `migrate deploy` on a fresh DB yields an empty diff vs schema. Non-destructive, idempotent data-safety scripts live in `scripts/`/`prisma/scripts/` (`cfo:snapshot`/`cfo:restore`).
- Model groups: core/tenant, CRM, PoC, mail, finance/CFO, engagement/support, product-catalog, governance/audit, AI, color-agent (full list in `prisma/schema.prisma`).

## Dependencies
- Depends on: none (`@prisma/client`, `prisma`, `zod`).
- Depended on by: `@sangfor/business`, `@sangfor/mail-intelligence`, `apps/web`, `apps/api`, and DB scripts.

<!-- MANUAL: Notes below this line are preserved on regeneration -->
