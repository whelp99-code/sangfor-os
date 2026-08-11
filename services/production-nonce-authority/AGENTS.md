<!-- Parent: ../../AGENTS.md — repo-wide rules and Working Norms (Fable Doctrine, F1–F14) live there -->

# @sangfor/production-nonce-authority — single-use production-nonce consumer

> Cloudflare Worker + Durable Object that atomically consumes single-use production-approval nonces (`POST /v1/production-nonces/consume`). Part of the U076 production-deploy gate: the release mirror consumes a nonce here so an approval can never authorize two deploys. Standalone workspace (own lockfile, NOT in the root pnpm workspace); its release-gate scope is `nonce` in `scripts/release-gate.manifest.json`.

## Constraints
- **Fail-closed by design.** Strict request validation (exact key set, `schemaVersion: 1`, nonce/sha regex patterns, 4 KB body cap, fatal-UTF-8 decode) and constant-time bearer comparison (`NONCE_CONSUME_BEARER_TOKEN`, min 32 chars). Loosening any check needs a security rationale.
- **Consumption is atomic and permanent.** `ProductionNonceConsumer` Durable Object stores consumed nonces in DO SQLite (`consumed_nonces`); a replay returns `consumed: false`. Never add a delete/reset path.
- Single-file worker: `src/index.ts` (~160 lines). Keep it dependency-free; bindings are declared in `wrangler.jsonc` and typed in `worker-configuration.d.ts` (generated — do not hand-edit).

## Working Here
- Runs via the deterministic wrapper: `bash scripts/run-workspace-runtime.sh nonce -- pnpm <cmd>` (root repo). Locally: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- `pnpm build` = `wrangler deploy --dry-run` (no real deploy); tests run under the Cloudflare vitest workers pool (miniflare bindings `APPROVAL_ISSUER`, `NONCE_CONSUME_BEARER_TOKEN`) in `test/`.
- CI: `.github/workflows/services-ci.yml` (path-scoped) + the `nonce` lane of `pnpm verify:release`. Canary check: `scripts/nonce-authority-canary.test.mjs` at repo root.

## Dependencies
- Depends on: `cloudflare:workers` runtime only (no `@sangfor/*` imports).
- Depended on by: repo-root release tooling (`scripts/run-detached-release-mirror.mjs`, `scripts/sign-external-approval.mjs`, `scripts/verify-production-readiness.mjs`) over HTTPS — no code-level dependents.

<!-- MANUAL: Notes below this line are preserved on regeneration -->
