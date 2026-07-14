# R11-R15 Claude Handoff

- Date: 2026-07-13 (Asia/Seoul)
- Branch: `fix/ux-loop-2026-07-13`
- Baseline before this work: `f3f5173`
- Scope completed: R11-R15
- Next scope: R16-R20, not started

## 1. Read this first

The R11-R15 implementation and three-arm R15 cross-validation are complete. Continue from the commits below; do not replay the old R11-R15 mutation harness against `sangfor_os`.

The most important unresolved operational fact is a production-database baseline drift detected during final cleanup. The production dump changed while the isolated loop was running. No production rows were deleted or rewritten because that requires explicit approval. Recovery backups remain under `/tmp/sangfor-pg-ulw.SGcoxE` and must not be removed until the drift is attributed or the user approves disposal.

## 2. Commits produced

| Commit | Purpose |
| --- | --- |
| `a599bf3` | Align root/API/Gemini guidance with the actual Express REST surface and record Fable/Claude plugin cleanup work. |
| `f905c97` | Require `system_admin` for arbitrary MCP tool execution and test the real Express/JWT boundary. |
| `6b069d6` | Point the PostgreSQL healthcheck at the existing `sangfor_os` database. |
| `ff6b83f` | Bind sessions to signed project scope, close IDOR/viewer writes, add optimistic concurrency, and make approval conversion race-safe. |
| `4127611` | Make AI revalidation fallback explicit, Korean, non-approving, and safe from raw error leakage. |
| `14c2413` | Support an isolated `NEXT_DIST_DIR` and the `127.0.0.1` QA hydration origin. |
| `2f6ccc9` | Contain responsive layouts/tables and restore visible keyboard focus behavior. |

These commits are local. No push, PR mutation, merge, deployment, or release action was performed.

## 3. Functional changes by round

### R11: privilege and responsive boundaries

- `POST /api/whelp99/tools/call` now requires an authenticated `system_admin` role. An `account_manager` receives `403` before the MCP adapter is invoked.
- Portal layout wrappers use `min-w-0`; tables scroll within their own container instead of expanding the document.
- Cockpit grids use `minmax(0, 1fr)`, mobile body copy respects the 16px minimum, and keyboard focus has a visible brass outline.
- PostgreSQL healthcheck explicitly selects `sangfor_os`.

### R12: project isolation

- Session payloads require `projectId` and `projectSlug`; malformed or legacy scope-less tokens fail validation.
- Login resolves the default project server-side and signs both claims.
- `resolveProjectScope` revalidates the signed ID/slug pair against the database.
- Customer, opportunity, registration, POC, proposal, task, and engagement routes reject foreign `projectSlug` and cross-project related IDs.
- Cross-project detail requests return `404`; an invalid signed project pair returns `403`.

This remains a single-default-project policy, not full membership-based multi-tenant RLS. The current operational RLS script is not the enforcement mechanism.

### R13: contention safety

- Opportunity edits and stage advances accept `expectedUpdatedAt` and use compare-and-swap behavior. Stale writes return `409 opportunity_conflict` with a Korean user-facing message.
- Mail candidate approval claims the candidate through `updateMany`, permits only one converter, returns idempotent success after conversion, and restores the prior status if entity creation fails.
- Live concurrency evidence observed exactly one approval winner and nine conflicts, plus exactly one stale-opportunity winner and one conflict.

### R14: AI honesty

- LLM failure uses a safe Korean fallback reason and forces `needs_human_review`; a template fallback never auto-approves.
- The candidate detail page shows a dedicated status notice, hides raw internal values such as `openai_timeout`, and renders an explicit metadata empty state.
- Korean title wrapping uses `break-keep` with a long-token overflow fallback.

### R15: independent cross-validation

- Root, Terra, and the Codex security arm independently passed the executed matrix after root fixes.
- The security arm found a real viewer escalation: customer create, opportunity update, and mail approval returned `201/200/200`. The shared API guard now returns `403/403/403` while viewer GET remains available.
- Viewer deal pages expose no visible edit, advance, conversion, orchestrator, or inline-edit controls. Operator controls remain visible.
- Deal tab navigation now uses `history.pushState`; Chromium verified 상세 -> 문서 -> Back 상세 -> Forward 문서.
- `allowedDevOrigins: ["127.0.0.1"]` fixes the isolated QA host's HMR/hydration rejection.
- agy could not execute its R15 arm because of an individual quota limit. Terra served as the third independent validator; no result is falsely attributed to agy.

## 4. Verification evidence

Current Node 20 verification after the implementation:

- `pnpm typecheck`: exit 0 across 14 workspaces.
- `pnpm lint`: exit 0. Existing repository warnings remain; no lint errors.
- `pnpm --filter @sangfor/api test`: 57 passed, 23 skipped, exit 0.
- Focused Web security/UI suite: 56 passed, exit 0.
- Focused Business concurrency/AI suite: 32 passed, exit 0.
- `pnpm --filter @sangfor/api build`: exit 0.
- `NEXT_DIST_DIR=.next-uxtest-r20 pnpm --filter @sangfor/web build`: exit 0; all 72 static pages generated and dynamic routes compiled.
- `git diff --check`: exit 0.

With the isolated QA database running earlier in R15:

- Full Web suite: 166 passed, 6 skipped.
- Full Business suite: 674 passed, 30 skipped.
- Real browser viewer/operator check: zero console/page errors; viewer mutation affordances 0, operator inline editors 6.

After runtime cleanup, a fresh full Web run reports 164 passed and 2 failed because `src/app/api/agent/schedules/tick/route.test.ts` directly requires PostgreSQL on `localhost:5434`. This is an environment failure, not a changed assertion. Do not start the production-bound database merely to make this suite green; recreate the isolated QA runtime first.

Primary local evidence, intentionally not committed because the capture set is about 44 MB:

- `.agents/results/ux-loop/r11-r20/r15/root/report.md`
- `.agents/results/ux-loop/r11-r20/r15/reconciliation.md`
- `.agents/results/ux-loop/r11-r20/r15/terra/matrix.md`
- `.agents/results/ux-loop/r11-r20/r15/codex/report.md`
- `.agents/results/ux-loop/r11-r20/db-isolation-before-after.json`

## 5. Runtime and cleanup state

- QA listeners `3110` and `3230`: closed.
- `sangfor-postgres` and `sangfor-redis`: stopped with exit code 0, matching their pre-loop state.
- Redis DB 15: flushed, `DBSIZE=0` before shutdown.
- Fresh QA clone: dropped.
- Pre-existing `sangfor_os_uxtest_pre_ulw_20260713`: renamed back to `sangfor_os_uxtest`; 151 public tables.
- R15 and leaked R12 fixture counters in the fresh clone: zero before the clone was dropped.
- Temporary JWT/token files and `.next-uxtest-r20`: removed.

Do not delete `/tmp/sangfor-pg-ulw.SGcoxE` yet. It contains the cold PostgreSQL volume archive, the pre-loop production logical backups, and the preserved pre-existing QA dump.

## 6. Production drift warning

The normalized pre-loop production dump hash was:

`2bee6ebaf3f0fd7f7d1ea5ccc874a5dae78fb1a631fe4b2ad858eb92840add02`

The normalized post-loop production dump hash was:

`f9db3d1ef97589972f8502d7b07dafe3bcee8d14f4962cc3978f864e0236096e`

Only PostgreSQL 16's random `\restrict`/`\unrestrict` token lines were removed for comparison. The diff includes rows created during the elapsed loop window. Their source has not been fully attributed between existing background processes and tests that load the root `.env`.

Rules for follow-up:

1. Do not delete or rewrite production rows without explicit user approval.
2. Before any DB-touching test, set an explicit disposable `DATABASE_URL`; never rely on the root `.env`.
3. Compare the retained baseline against current production and classify rows by table, timestamp, and fixture markers before proposing cleanup.
4. Preserve the backup directory until the user decides whether to retain or remove it.

## 7. Working-tree residue deliberately excluded from commits

- `apps/web/next-env.d.ts` points to the removed QA dist directory. It is generated by Next and was already dirty before this commit task. A normal Next invocation without `NEXT_DIST_DIR` should regenerate the `.next` reference; do not commit the QA-specific path.
- `.agents/coop/`, `.agents/results/ux-loop/`, older KPI logs/backups, `brain/`, and `cookie.txt` remain untracked and were not swept into the commits.
- Treat all unrelated untracked files as user-owned. Inspect before changing or deleting them.

## 8. Recommended continuation

The user explicitly stopped after R15. Do not start R16 until asked.

When continuation is authorized:

1. Re-read `AGENTS.md`, this handoff, and `docs/DEV_REFERENCE.md`.
2. Create a new isolated database from a verified logical backup and use a dedicated Redis DB and Next dist directory.
3. Capture a production fingerprint before starting any test process.
4. Execute R16 corrective CRUD/forced conversion, then R17 reachability, R18 CFO truthfulness, R19 responsive/i18n/keyboard, and R20 frozen release cross-validation.
5. Keep PR push/merge/deploy and production cleanup behind explicit approval gates.
