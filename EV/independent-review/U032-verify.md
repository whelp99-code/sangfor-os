# U032 Independent Verification — CRM scope, archive, and canonical owner expansion

## Verdict: PASS

Fresh, non-author adversarial verification of unit U032 (DB-SCHEMA expand unit) in the
uncommitted worktree `/Users/jmpark/orca/workspaces/sangfor-os/sangfor-u032`
(branch `whelp99-code/sangfor-u032`, HEAD == base `13a55023`, changes unstaged).

- **Live Postgres achieved:** YES. Real isolated `postgres:16` containers on the pinned digest
  `sha256:57c72fd2a128...` (Docker 29.6.1) for all 11 prior db:contract suites and the U032
  verify-expand-migration lifecycle. Each spun a fresh container (Docker-assigned random loopback
  port, uniquely-suffixed container/network/volume) and cleaned up.
- **U032 shape:** EXTENDS EXISTING MODEL COLUMNS ONLY. Adds NO Prisma model. `scope:check`
  reports `currentModelCount=161`, `inventoryModelCount=161`, `ok:true`, zero missing/unknown/
  duplicate. `scope-inventory.ts` / `scope-inventory.test.ts` are UNCHANGED (correct — no
  REGISTERED_ADDITIONS needed).

---

## Check 1 — BOUNDARY: PASS

`git status --porcelain` shows exactly the dispatch Create+Modify set and nothing else:

```
 M packages/db/prisma/schema.prisma
 M packages/db/scripts/run-db-contract.ts
?? packages/db/prisma/migrations/20260716003200_u032_crm_scope_archive_owner_expand/
?? packages/db/scripts/verify-expand-migration.mjs
?? packages/db/src/schema-contracts/   (crm-domain-schema.test.ts, crm-domain-schema.integration.test.ts, helpers.ts)
```

Read-only inputs confirmed UNCHANGED vs base `13a55023`:
`scope-inventory.ts`, `scope-inventory.test.ts`, `index.ts`, `scope-check.ts`,
`packages/config/**`, `apps/web/src/lib/auth/**` (all empty `git diff`). Root barrel untouched.
No out-of-boundary edit. schema.prisma diff touches only `Customer`, `Opportunity`, `WorkTask`,
`UserCompanyRole` (inverse relations) — `Project`/`UserCompanyRole` scoped to the required
relations. After my verification runs the tracked diff is still exactly the owned set (all test
output went to `/tmp`).

## Check 2 — DB-SCHEMA SAFETY: PASS

- **scope:check** EXIT 0 — `ok:true`, `currentModelCount==inventoryModelCount==161`, zero gaps/dupes.
  (Prisma client re-generated first in the fresh worktree, so DMMF is truthful.)
- **Prefix-builder exclusions (run-db-contract.ts):** `NEW_MIGRATION_NAME_U032` is excluded from
  every historical-prefix builder — `makeTempPrismaCopy` (only in the `!includeNewMigration`
  branch), `makeThroughU011PrismaCopy`, `listMigrationsThroughU010`, `listMigrationsThroughU020`,
  and the role-change legacy `before` filter — and correctly RE-ADDED to the full-deploy / current
  views: the `remainingAfterU012` full-deploy lane (auto-includes because it is unfiltered), the
  audit-chain final view (`addMigrationToView` + `verifyViewIntegrity`), and the role-change
  post-fixture view. Every site that carries U024 also carries U032, and the two full-deploy lanes
  correctly do NOT filter it.
- **No new hard-coded count pin:** `grep -nE "currentModelCount (!==|===) [0-9]+"` finds nothing
  (exit 1). Counts are computed dynamically (`currentModelNames.length` / `entries.length`).
- **Tally guard:** no scope-closure tally change was needed (no model added); scope-closure suite
  still passes with `emptySchemaDiff:true`.
- **Every new @@index has a matching CREATE INDEX + empty migrate-diff:** proven live — see Check 5.

## Check 3 — NO SIBLING REGRESSION: PASS

All 11 prior db:contract suites run BY ME on real isolated PG, each EXIT 0:

```
scope-backfill 0   scope-closure 0   principal-session 0   business-role 0   rls-pilot 0
artifact-schema 0  approval-schema 0 workflow-schema 0     governance-bridge 0
audit-chain 0      role-change 0
```

scope-closure receipt: `result:"PASS"`, `emptySchemaDiff:true`, `deployRemainingAfterU012`
(the full-chain lane that now includes U032) migrated cleanly. The two suites that enumerate and
re-assemble the migration set around the newest additive migrations (audit-chain, role-change)
both pass with U032 folded into their final full views. No leftover containers/volumes/networks.

## Check 4 — ARCHIVE/OWNER SEMANTICS: PASS

Verified against schema.prisma, migration.sql, the DMMF contract test, and the LIVE owner-guard
integration suite (8/8):

- **Customer** gains `archivedAt DateTime?` (`archived_at`) ONLY — no owner column, no owner inverse
  relation, no owner index, no owner guard. DMMF test asserts `Customer.ownerAssignmentId` /
  `ownershipRevision` THROW "not found" and the CAS index is absent. Customer is NOT an 8th
  transferable owner.
- **Opportunity / WorkTask** each gain `ownerAssignmentId String? -> UserCompanyRole.id`
  (FK `ON DELETE SET NULL`, matching Prisma `onDelete: SetNull`) and required
  `ownershipRevision Int @default(0)`. Legacy `Opportunity.ownerId -> User` and
  `WorkTask.assigneeName` remain readable, non-authoritative history.
- **Named inverse relations** `UserCompanyRole.ownedOpportunities` / `ownedWorkTasks` present.
- **Indexes:** scoped-list `(projectId, archivedAt, updatedAt, id)` on all three; CAS
  `(ownerAssignmentId, ownershipRevision)` ONLY on Opportunity/WorkTask (Customer correctly excluded).
- **Guards** (`opportunities_owner_scope_guard_fn/trg`, `work_tasks_owner_scope_guard_fn/trg`):
  exactly one `BEFORE INSERT OR UPDATE` per named table. They reject a missing / inactive
  (`status<>'active'`) / expired (`expires_at`) / not-yet-valid (`valid_from`) / revoked
  (`revoked_at`) assignment, and an assignment whose `company_id` differs from the row's
  `Project.company_id` — consuming the U010 `Project.companyId` bridge. On owner change they require
  `ownership_revision = OLD + 1` (increment exactly once), reject a revision change without an owner
  change, and reject rewriting immutable legacy attribution (`owner_id` for opportunities;
  `assignee_name`/`source` for work_tasks). The migration is additive-only (no DML, no destructive
  DDL, no `SET NOT NULL`, no `VALIDATE CONSTRAINT` — asserted by the DMMF/SQL contract).
  Live proof: `crm-owner-guards` integration suite 8/8 passed — accepts same-company active,
  rejects `owner-b`/`inactive`/`expired`/`revoked`/`missing`, CAS increments once with a stale
  `expectedOwnershipRevision`=0 conflict and an idempotent replay yielding 0 rows, and rejects an
  owner update that rewrites legacy attribution.

## Check 5 — ACCEPTANCE RE-RUN: PASS (all EXIT 0)

| Command | Exit | Notes |
|---|---|---|
| `prisma validate` | 0* | *bare fails ONLY on `DATABASE_URL` env-gap; with a placeholder URL → "schema is valid". Benign. |
| `db:generate` | 0 | Prisma Client v6.19.3 generated. |
| `scope:check` | 0 | 161/161, ok:true. |
| `crm-domain-schema.test.ts` + `scope-inventory.test.ts` | 0 | 50 tests passed (5 + 45). |
| `verify-expand-migration.mjs --suite crm-owner-guards` | 0 | LIVE. 52 migrations applied (U032 last), `migrate diff` empty ("-- This is an empty migration."), `_prisma_migrations` receipt = U032 finished, `crm-owner-guards` 8/8, `database_runtime_verification=ISOLATED_SCRATCH_PASS`, clean teardown. |
| business `opportunity-center` + `opportunity-stage` | 0 | 58 tests passed. |
| web `customers/[id]/route.test.ts` | 0** | **bare fails ONLY on `USER_JWT_ACTIVE_KID` env-gap in unchanged `packages/config`; with an ephemeral keyring → 1 test passed. Benign. |
| typecheck db / business / web | 0 / 0 / 0 | all pass. |
| `git diff --check` | 0 | no whitespace errors. |

- **Red-first present:** codex's `red.log` shows the DMMF/SQL contract EXIT 1 pre-implementation
  ("Customer.archivedAt and Opportunity.ownerAssignmentId absent from DMMF; migration.sql path did
  not exist"), consistent with the test's structural coupling (`dmmfField` throws "not found" for
  absent fields; `readU032Migration` reads a not-yet-existing path). I did not reproduce by mutation
  to honor the read-only constraint.
- **codex deviation assessed BENIGN:** fresh-worktree config/shared/auth builds + `db:generate`
  (required because a fresh worktree ships no generated client), a placeholder `DATABASE_URL` for
  `prisma validate` metadata, and an ephemeral `USER_JWT_*` keyring for the web route test. All
  three are environment gaps in code OUTSIDE U032's boundary (`packages/config` unchanged) or
  standard fresh-worktree bootstrap. With them supplied, every acceptance command is green. No
  product behavior outside U032 changed.

## Check 6 — LEAKS: PASS

Zero leftover `sangfor-pg*` containers, `sangfor-vol*` volumes, or `sangfor-net*` networks after
all runs. `git status` still shows only the owned diff. Worktree evidence dir (`.omo/evidence/...`)
is gitignored. My verification wrote only to `/tmp/u032-verify` and generated the Prisma client /
dep builds into gitignored `node_modules`.

---

## Strongest break attempt

I targeted the single most dangerous failure mode for a schema-expand unit: a new migration silently
polluting a historical-prefix fixture or drifting the schema from the migration. I confirmed U032 is
excluded from every historical prefix builder yet re-added to both full-deploy lanes, then ran the
verify-expand lifecycle on live PG: it deployed all 52 migrations (U032 last) into a fresh container
and `prisma migrate diff --from-url <scratch> --to-schema-datamodel schema.prisma` returned
"-- This is an empty migration." — the schema and migration are in exact byte-for-byte sync, so every
new column, FK, and @@index has a matching DDL and there is no drift. Backed by all 11 sibling
suites green and scope-closure's own `emptySchemaDiff:true`, the migration is provably deployable
and non-regressive. It held.
