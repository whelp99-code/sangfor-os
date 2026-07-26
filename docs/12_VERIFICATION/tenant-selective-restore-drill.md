# U074 — Tenant-Selective Restore Drill (S9b)

## Scope

This is a **fixture-only** tenant-selective export/import drill. It is NOT a production restore tool.

### What this drill does

1. Exports a synthetic tenant scope (company/project roots + CHILD_VIA_FK paths) from one U009-owned isolated Postgres 16 instance
2. Imports into a different synthetic target tenant/company/project with deterministic ID remapping
3. Validates semantic hashes, FK topology, and idempotent replay
4. Proves atomic rollback on tampered/cross-scope manifests

### What this drill does NOT do

- Access real backups or production databases
- Perform staging/production restore or import
- Select PITR targets
- Execute production apply windows
- Perform destructive cleanup outside U009-labelled resources

## Separation from S9a

- **S9a** (U009): Isolated full-database logical restore — complete database export/import
- **S9b** (U074): Fixture tenant extraction/import — selective scope traversal with ID remapping
- **Future real restore**: Requires explicit approval outside U001–U076

## Running the drill

```bash
# Full isolated lifecycle (creates and cleans two U009-labelled Docker resources)
pnpm --filter @sangfor/db drill:tenant-restore

# The same lifecycle through Vitest (requires Docker)
CI_INTEGRATION=1 pnpm --filter @sangfor/db exec vitest run src/tenant-restore/tenant-restore.integration.test.ts
```

## Safety contract

- Rejects caller `DATABASE_URL`, remote `DOCKER_HOST`, missing image digest
- Uses U009 `withIsolatedPostgresPair` for source/target databases
- Allows only `companies`, `projects`, `customers`, and `customer_activity_logs` identifiers and validates every imported column against Prisma DMMF
- Uses deterministic target IDs plus target-row hash comparison for idempotency; `_prisma_migrations` remains exclusively Prisma's migration history and is never an import ledger
- No real dump, home backup directory, staging/production, PITR, or network destination
- No generic admin endpoint, UI restore button, or production import switch

## Evidence

Directory: `.omo/evidence/sangfor-system-refactor-2026-07-15/U074/attempt-<n>/`

Required: export manifest, ID/FK remap map, source/target counts, semantic hashes, idempotency proof, tamper rejection, cleanup receipt.
