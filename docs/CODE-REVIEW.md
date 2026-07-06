# Code Review Standards

Review standards for `sangfor-os`. Referenced from [AGENTS.md](../AGENTS.md) so review agents load it automatically. Pairs with the quality gate `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

## Severity levels
- **Blocker** — security / data-integrity / approval-gate violation, or a broken quality gate. Must fix before merge.
- **Major** — correctness bug, missing tenant scoping, missing test for new behavior, or an architecture/layering violation.
- **Minor** — maintainability, naming, duplication, small perf.
- **Nit** — style/preference; non-blocking.

## Review checklist (every PR)
1. **Quality gate passes** — lint, typecheck, test, build. Integration paths ran under `CI_INTEGRATION=1` where relevant.
2. **Approval gates intact** — send/delete/deploy/export/prod-mutation stays behind an approval gate; no new irreversible action bypasses it.
3. **Trust boundary** — no `tenantId`/`companyId`/approver identity trusted from the request body; money (quote margin/totals) computed server-side.
4. **AI-as-draft** — AI output is not treated as approved; drafts carry source evidence and pass the AI/quality gate.
5. **DB discipline** — schema change is additive/nullable and ships a formal migration; no `db push --accept-data-loss`; Prisma accessed only via the `@sangfor/db` singleton.
6. **Layering** — dependency direction respected (see AGENTS.md DAG); `business` does not import `agent`/`infra`/`apps`; no new cross-cutting logic in ad-hoc files.
7. **Tests** — new behavior has a colocated `*.test.ts`; golden/snapshot changes are intentional, not blind updates.
8. **Secrets** — no tracked `.env`, no literal API keys (`sk-…`); secrets validated via `@sangfor/config` and masked on log.

## Domain-specific focus
- **Finance (apps/api, business/finance):** server-side math, `financeAccessGuard`, idempotent ledger writes, HomeTax decryption key from `CompanySettings` not code.
- **Mail:** `sanitizeJsonStrings` before jsonb persist (lone-surrogate crash); `@sangfor/mail-intelligence` stays read-only (no send/delete/move).
- **Auth (apps/web):** every mutating route calls `assertApiAccess`; dev escape hatches (`AUTH_BYPASS_ENABLED`, mock admin token) never reach prod paths.
- **Domain-AI:** LLM config hydrated (db→env) before calls; model-policy data-classification gating rejects — not silently downgrades — disallowed models.

## Anti-patterns to flag
- `new PrismaClient()` anywhere but the `db` singleton.
- A fresh `db push` on a stale schema (root cause of past data loss).
- Committing generated/mock data as if real; treating AI drafts as approved output.
- Wide `export *` that leaks internal helpers across a package boundary.

## Human review vs auto-approve
Request **human** review for: schema/migration changes, anything touching approval gates, auth, finance math, or RLS/tenant scoping, or any irreversible action. Routine, well-tested, single-surface changes with a green quality gate may auto-merge (see `scripts/round-ship.sh`).
