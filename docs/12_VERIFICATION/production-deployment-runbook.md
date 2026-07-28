# Production Deployment Runbook

## Hard gates

1. Use a clean committed worktree; untracked files are rejected.
2. Supply the candidate-bound authoritative-mirror U076 `final-acceptance.json` proving `LOCAL_PASS_EXTERNAL_PENDING` and a separately approved `AC-DOD-09` receipt proving `MANUAL_EXTERNAL_PASS`, the same run ID, the exact local acceptance SHA-256, and verified artifact hashes. The receipt must be Ed25519-signed by the issuer pinned in the root-owned authority file. The configured HTTPS nonce authority must atomically return `201` for the first consumption and reject replay on every deployment host.
3. Keep `.env.production` mode `0600` and `BACKUP_DIR` mode `0700`. Production rejects `AUTH_DEMO_PASSWORD`; provision a per-user credential before cutover.
4. Run `scripts/deploy-production.sh --check` before the approved deployment command.

Start from `production.env.example`. The configured default tenant, company, and project must identify one existing production hierarchy before application startup.

Provision `production-authority.example.json` as `/etc/sangfor-os/production-authority.json`, replace every placeholder, and set the file plus its deployment-receipt private key to root-owned mode `0600`. This path is fixed in code and cannot be replaced by `.env.production` or ambient environment values. The nonce bearer credential is consume-only; it must not be able to issue or sign approvals.

```bash
scripts/deploy-production.sh \
  --env-file .env.production \
  --final-acceptance /absolute/path/final-acceptance.json \
  --external-receipt /absolute/path/ac-dod-09-pass.json \
  --confirm-production
```

The Compose dependency graph creates and hashes `BACKUP_DIR/predeploy-<deployment-id>.dump` before applying formal migrations and refuses to overwrite an existing backup. The deployment ID includes candidate SHA, UTC timestamp, and process ID. Runtime Prisma uses `sangfor_runtime_login`, which has no RLS bypass and inherits `sangfor_app`; its connection pins the configured default tenant/company/project settings so unscoped direct Prisma paths cannot cross that boundary. Explicit scope-bound operations continue through `sangfor_app_login` and transaction-local `SET ROLE sangfor_app`.

## Credential provisioning

Create or rotate one reviewed active user's credential without placing the password in argv. Rotation revokes all existing sessions for that user.

```bash
printf '%s' "$NEW_PASSWORD" | pnpm provision:user-credential \
  --email operator@example.com \
  --confirm-user-id <reviewed-user-id> \
  --password-stdin
```

## Application rollback

Every successful deployment retains SHA-tagged API/Web images, the exact owner-only Compose artifact used for that deployment, and an Ed25519-signed receipt under `.local-prod/deployments/`. The receipt binds the candidate, project, immutable Docker image IDs, authority configuration hash, and Compose artifact hash. Rollback rejects unsigned or altered receipts and artifacts, ignores mutable tags for execution, requires both retained IDs to exist, and starts the signed Compose artifact by those IDs. Because repository migrations are additive and forward-compatible, application images can be rolled back without reversing schema:

```bash
scripts/rollback-production.sh \
  --env-file .env.production \
  --receipt .local-prod/deployments/<deployment-id>.json \
  --confirm-rollback
```

The rollback must pass external HTTPS `/health` and `/login`. Database restore is destructive and is never automated by this script. If additive compatibility is insufficient, stop mutation traffic and use the predeploy dump only through an explicitly approved production restore procedure and a separate isolated restore rehearsal.
