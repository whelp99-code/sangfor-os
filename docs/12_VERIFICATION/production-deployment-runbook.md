# Production Deployment Runbook

## Hard gates

1. Use a clean committed worktree; untracked files are rejected.
2. Supply the candidate-bound authoritative-mirror U076 `final-acceptance.json` proving `LOCAL_PASS_EXTERNAL_PENDING` and a separately approved `AC-DOD-09` receipt proving `MANUAL_EXTERNAL_PASS`, the same run ID, the exact local acceptance SHA-256, and verified artifact hashes. The receipt must be Ed25519-signed by the issuer pinned in the root-owned authority file. The configured HTTPS nonce authority must atomically return `201` for the first consumption and reject replay on every deployment host.
3. Keep `.env.production` mode `0600` and `BACKUP_DIR` mode `0700`. Production rejects `AUTH_DEMO_PASSWORD`; provision a per-user credential before cutover.
4. In a clean deployment-control checkout, provision the canonical TypeScript loader before preflight:

   ```bash
   corepack pnpm install --prod --frozen-lockfile
   ```

5. Run `scripts/deploy-production.sh --check` before the approved deployment command.

Start from `production.env.example`. The configured default tenant, company, and project must identify one existing production hierarchy before application startup.

Provision `production-authority.example.json` as `/etc/sangfor-os/production-authority.json`, replace every placeholder, and set the file plus its deployment-receipt private key to root-owned mode `0600`. This path is fixed in code and cannot be replaced by `.env.production` or ambient environment values. The nonce bearer credential is consume-only; it must not be able to issue or sign approvals.

## Nonce authority deployment

The nonce authority is a separate Cloudflare Worker with a SQLite-backed Durable Object. It is not deployed by `scripts/deploy-production.sh`; deploy it and capture its HTTPS endpoint before placing that endpoint in the root-owned production authority file. The commands below do not put a secret in an argv value.

```bash
cd services/production-nonce-authority
corepack pnpm install --ignore-workspace --frozen-lockfile
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build

# First deployment: use a deploying-user-owned mode-0600 dotenv or JSON secrets file that
# contains only NONCE_CONSUME_BEARER_TOKEN and the exact APPROVAL_ISSUER pinned
# in production-authority.json. Do not source, echo, commit, or pass its values
# as command arguments. This creates the Worker, applies its DO migration, and
# uploads both secret bindings in one deployment.
corepack pnpm exec wrangler deploy --secrets-file /secure/path/production-nonce-authority.secrets.env
```

For a later token rotation on the already-deployed Worker, provide the replacement token from standard input or a protected file, never argv:

```bash
corepack pnpm exec wrangler secret put NONCE_CONSUME_BEARER_TOKEN < /secure/path/nonce-consume-bearer-token
```

`APPROVAL_ISSUER` is deliberately not a request-controlled value. After the initial `corepack pnpm exec wrangler deploy` completes, copy the `https://<worker>.<account>.workers.dev` URL it prints and configure it as `nonceConsumeUrl` in that authority file. Do not use a non-HTTPS URL.

Before authorizing a production application deployment, perform an operational proof against the captured HTTPS URL with a distinct, never-deployed canary receipt, nonce, and request. Its first `POST /v1/production-nonces/consume` must return `201` with `schemaVersion: 1`, `consumed: true`, the submitted canary nonce, and the submitted canary receipt SHA-256. Re-submit that exact canary request and verify `409`; the replay result must not alter the original consumption record. Do not use the real deployment receipt, nonce, or request for this canary: its nonce must remain unconsumed until `verify-production-readiness` and the approved `deploy-production.sh` cutover consume it. Record only status and non-secret identifiers in the deployment evidence—never the bearer token or full request body.

```bash
scripts/deploy-production.sh \
  --env-file .env.production \
  --final-acceptance /absolute/path/final-acceptance.json \
  --external-receipt /absolute/path/ac-dod-09-pass.json \
  --confirm-production
```

The deployer archives the approved Git commit before consuming approval, builds only from that immutable archive, and pins Compose's project directory to the extracted candidate. It also preflights the deployment signing private/public key pair before nonce consumption or cutover. The Compose dependency graph creates and hashes `BACKUP_DIR/predeploy-<deployment-id>.dump` before applying formal migrations and refuses to overwrite an existing backup. The deployment ID includes candidate SHA, UTC timestamp, and process ID. Runtime Prisma uses `sangfor_runtime_login`, which has no RLS bypass and inherits `sangfor_app`; its connection pins the configured default tenant/company/project settings so unscoped direct Prisma paths cannot cross that boundary. Explicit scope-bound operations continue through `sangfor_app_login` and transaction-local `SET ROLE sangfor_app`.

## Credential provisioning

Create or rotate one reviewed active user's credential without placing the password in argv. Rotation revokes all existing sessions for that user.

```bash
printf '%s' "$NEW_PASSWORD" | pnpm provision:user-credential \
  --email operator@example.com \
  --confirm-user-id <reviewed-user-id> \
  --password-stdin
```

## Application rollback

Every successful deployment retains SHA-tagged API/Web images, the exact owner-only Git source archive and Compose artifact used for that deployment, and an Ed25519-signed receipt under `.local-prod/deployments/`. The receipt binds the candidate, project, immutable Docker image IDs, signing-key fingerprint, source archive, and Compose artifact. Retain old public keys with `status: "verify"` when rotating the active signing key so prior rollback receipts remain valid. Rollback rejects unsigned or altered receipts and artifacts, re-extracts the signed source archive, ignores mutable tags for execution, requires both retained IDs to exist, and starts the signed Compose artifact by those IDs. Because repository migrations are additive and forward-compatible, application images can be rolled back without reversing schema:

```bash
scripts/rollback-production.sh \
  --env-file .env.production \
  --receipt .local-prod/deployments/<deployment-id>.json \
  --confirm-rollback
```

The rollback must pass external HTTPS `/health` and `/login`. Database restore is destructive and is never automated by this script. If additive compatibility is insufficient, stop mutation traffic and use the predeploy dump only through an explicitly approved production restore procedure and a separate isolated restore rehearsal.
