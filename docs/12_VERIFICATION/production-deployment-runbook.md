# Production Deployment Runbook

## Hard gates

1. Use a clean committed worktree; untracked files are rejected.
2. Supply the candidate-bound authoritative-mirror U076 `final-acceptance.json` proving `LOCAL_PASS_EXTERNAL_PENDING` and a separately approved `AC-DOD-09` receipt proving `MANUAL_EXTERNAL_PASS`, the same run ID, the exact local acceptance SHA-256, and verified artifact hashes.
3. Keep `.env.production` mode `0600` and `BACKUP_DIR` mode `0700`. Production rejects `AUTH_DEMO_PASSWORD`; provision a per-user credential before cutover.
4. Run `scripts/deploy-production.sh --check` before the approved deployment command.

```bash
scripts/deploy-production.sh \
  --env-file .env.production \
  --final-acceptance /absolute/path/final-acceptance.json \
  --external-receipt /absolute/path/ac-dod-09-pass.json \
  --confirm-production
```

The Compose dependency graph creates and hashes `BACKUP_DIR/predeploy-<deployment-id>.dump` before applying formal migrations and refuses to overwrite an existing backup. The deployment ID includes candidate SHA, UTC timestamp, and process ID. Runtime Prisma uses `sangfor_runtime_login`, which has DML and `BYPASSRLS` for trusted unscoped bootstrap reads but no superuser, database creation, role creation, schema creation, table ownership, DDL, or truncate privileges. Scope-bound business operations continue through `sangfor_app_login` and `SET LOCAL ROLE sangfor_app`.

## Credential provisioning

Create or rotate one reviewed active user's credential without placing the password in argv. Rotation revokes all existing sessions for that user.

```bash
printf '%s' "$NEW_PASSWORD" | pnpm provision:user-credential \
  --email operator@example.com \
  --confirm-user-id <reviewed-user-id> \
  --password-stdin
```

## Application rollback

Every successful deployment retains SHA-tagged API/Web images and writes an owner-only receipt under `.local-prod/deployments/<deployment-id>.json`. Because repository migrations are additive and forward-compatible, application images can be rolled back without reversing schema:

```bash
scripts/rollback-production.sh \
  --env-file .env.production \
  --to-sha <previous-40-hex-sha> \
  --confirm-rollback
```

The rollback must pass external HTTPS `/health` and `/login`. Database restore is destructive and is never automated by this script. If additive compatibility is insufficient, stop mutation traffic and use the predeploy dump only through an explicitly approved production restore procedure and a separate isolated restore rehearsal.
