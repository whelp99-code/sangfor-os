# U028 independent verification — WF-01c stateless workflow-service adapter

**Verdict: PASS_WITH_GAPS**

Fresh non-author verification of unit U028 (make `services/sangfor-mcp-workflow` a stateless
root adapter over the U025 canonical persisted runtime). Code verified UNCOMMITTED in worktree
`/Users/jmpark/orca/workspaces/sangfor-os/sangfor-u028` (branch `whelp99-code/sangfor-u028`,
base `13a55023`). Node/pnpm via `scripts/run-workspace-runtime.sh workflow|root`.

The core mechanism is sound: the `workflow-engine` package is genuinely stateless-delegating,
the MCP tool surface is neutralized at runtime, and every executable mutation/device/break-glass
path is fail-closed. It is **not** a clean PASS because (a) a residual local operation-approval
Map authority remains live in the operator console, (b) one of the two mandated new tests is not
discoverable by the project test runner, (c) `.env.example` never received the mandated U026 env
placeholders, and (d) the dispatch's item-9 SIGINT/SIGTERM cleanup tests and the U026
byte-compat / isolated-PG root round-trip were never implemented or proven.

---

## Check 1 — BOUNDARY (PASS)

- `git status` shows exactly the dispatch set: **9 modified + 3 untracked = 12 files**, all inside
  the Create/Modify boundary. No file outside the boundary was changed.
- U025 runtime **byte-unchanged**: `git status --porcelain packages/business/src/orchestration/ packages/business/src/index.ts` → empty.
- No new Prisma model/migration: `git status --porcelain packages/db/` → empty.
- `package.json` / `pnpm-lock.yaml` unchanged (manifests read-only as required).
- Two allowed-Modify targets were left **untouched** — a subset (boundary-legal), but note:
  - `apps/operator-console/src/middleware/auth.ts` — not modified (pre-existing server-side auth reused).
  - `.env.example` — not modified → **contract item 7 unmet** (see Check 3 / GAP-3).

## Check 2 — STATELESS ADAPTER (PARTIAL — engine PASS, service residual authority)

**workflow-engine package — genuinely stateless (PASS).**
- `approval-manager.ts`: every Map (`pendingApprovals`, `operationApprovals`, `approvalHistory`,
  `operationHistory`) deleted. Mutating methods throw `WorkflowAuthorityMovedError('authority_moved')`;
  reads return `[]`/`false`/zeroed stats. No restart source of truth.
- `breakglass-policy.ts`: all Maps/timers deleted. Every request/approve/deny/revoke throws
  `BreakGlassDisabledError('manual-gate')`; `isBreakGlassActive()`→`false`. No in-memory bypass.
- `workflow-executor.ts`: no Maps; `executeWorkflow` calls `denyWorkflowMutation` then throws
  `authority_moved`; pause/resume/cancel all `denyWorkflowMutation`.
- `canonical-workflow-client.ts` (new): a real stateless root client. Owns no data. Fixed WORKFLOW
  profile (issuer `sangfor-mcp-workflow`, audience `sangfor-web-workflow`, service `sangfor-mcp-workflow`),
  exact one-capability route map (create/read/activate/run.create/run.read/run.callback), server-derived
  tenant/company/project scope (never request JSON), signs an HS256 `x-sangfor-internal-principal`
  envelope binding method/path/bodyHash/queryHash, and fails closed to `degraded` on any root error.
- `device-verifier.ts` / `operation-orchestrator.ts`: `PostVerifier`/`DeviceVerifier` no longer default
  to `./outputs/*`; `explicitOutputRoot()` requires an absolute caller-owned root outside the workspace
  (and inside the declared attempt root); `OperationOrchestrator` throws `manual-gate` if no PostVerifier
  is injected. No `process.cwd()` derivation, no repo-tree output sink.

**MCP server — neutralized at runtime (PASS).**
- `apps/mcp-server/src/index.ts` passes an **empty** `catalog = new Map()` to `handleWorkflowJsonRpc`.
- `listWorkflowTools(catalog)` = `Array.from(catalog, …)` → `[]`; `tools/call` does
  `catalog.get(name)` → `undefined` → `METHOD_NOT_FOUND`. The self-approval tool still declared in
  `apps/mcp-server/src/tools/workflow-tools.ts` (`approvedBy` schema) is **dead/unregistered** — never
  reachable via the live stdio entrypoint. Startup logs "Registered 0 authority tools".

**Operator console — residual local approval authority (GAP-2, headline).**
- `server.ts` correctly drops `registerWorkflowRoutes`; `/api/workflows/:id/approve|reject` and
  `/api/break-glass/*` now return `410 authority_moved`; `/api/config` reports root configured/disabled.
- BUT `server.ts` still mounts `registerAutoOpsRoutes`, which is a **live local approval authority**:
  - `POST /api/plan` writes to `context.operationPlans` + `context.approvals` Maps.
  - `GET /api/approvals` reads local pending approvals.
  - `POST /api/approvals/:id/approve` sets `status='approved'`, `approvedBy`, `approvedAt` and flips the
    plan to `approved` — a **local self-approval surface writing local approval history**.
  - `POST /api/approvals/:id/reject` writes `rejectedBy`/`rejectionReason`.
  - `server-context.ts` still constructs `workflows`/`operationPlans`/`approvals`/`snapshots` Maps.
- This directly matches the dispatch's own "Current confirmed defect" wording ("operator … keep
  workflow/approval/**operation** Maps … mutate approval state") and its Must-not #10 ("write local
  approval history"). It was **not** removed because `auto-ops-routes.ts` / `server-context.ts` are
  **outside U028's declared file boundary** — a genuine dispatch-scope tension, not a stray edit.
- **Mitigations (why it is a gap, not a live bypass):** every executable path is hard-denied —
  `POST /api/execute/:planId`, `/api/breakglass/*`, `/api/remediation/:id/execute`,
  `/api/incidents/:id/remediation` all return `403 FORBIDDEN` via `denyWorkflowMutation` (U002
  containment). The local approval gates nothing that can mutate a device or the root. And `approvedBy`
  is derived from the **server** operator context (`getOperatorContext(response).principalId`), never
  from request body. So there is no root-bypassing action — but a local authoritative-looking approval
  record still exists, so service-wide "owns no approvals" is not literally achieved.

**Authority server-side only (PASS where present):** canonical client scope + principal come from
server config/scope; auto-ops `approvedBy` from server context. No body-supplied `approvedBy` accepted.

## Check 3 — ACCEPTANCE RE-RUN

Build deps first (root): `@sangfor/config` build EXIT 0, `@sangfor/auth` build EXIT 0,
`@sangfor/shared` build EXIT 0, `@sangfor/db db:generate` EXIT 0.

| Acceptance step | Result | Exit |
|---|---|---|
| `vitest run` — `tests/workflow-authority-removal.test.ts` + `tests/workflow-engine.test.ts` | **36 passed** (3 + 33), 2 files | 0 |
| `packages/workflow-engine/src/canonical-workflow-client.test.ts` via project runner | **"No test files found"** — not in vitest `include` globs (`tests/**`); the dispatch's own `pnpm test -- <file>` silently runs 0 for it | 1 (see GAP-1) |
| same test forced via `/tmp/u028-vitest.config.ts` (root+include override) | **2 passed** — logic is correct | 0 |
| `corepack pnpm lint` (workflow) | 0 errors / 117 warnings | 0 |
| `corepack pnpm build` (workflow) | mcp + operator bundles built | 0 |
| root `@sangfor/business` — isolated `vitest run src/orchestration/workflow-runtime.test.ts` | **3 passed** (U025 runtime intact) | 0 |
| `git diff --check` (root runtime) | clean | 0 |

Notes:
- The dispatch's literal test command (`pnpm test -- <3 paths>`) does **not** filter (confirmed) and,
  because `canonical-workflow-client.test.ts` lives under `packages/**/src/` (outside the config
  `include`), it is silently skipped — so the command exits 0 while executing only **2 of 3** mandated
  files. The third passes only under a forced config. **GAP-1.**
- The full workflow suite has 9 pre-existing/environmental failures, **none caused by U028**:
  `apps/mcp-server/src/tool-catalog.test.ts` (8) and `apps/operator-console/tests/server-split-regression.test.ts`
  (1) all throw `UNSAFE_AUTH_CONFIGURATION` from `resolveEngineerTsx` (`packages/shared/src/mutation-policy.ts:150`,
  **unmodified by U028** — engineer MCP tsx CLI unavailable, which the dispatch says not to configure);
  `tests/ai-workflow.test.ts` fails on `fixture.listenerCount() === 0` (LM Studio fixture teardown; imports
  only unmodified `llm-client`/`ai-workflow-generator`). Root business full run's 9 failures are all in
  `domain-ai/domain-agent-runtime.test.ts` (opencode/db down — environmental), not workflow-runtime.
- **Red-first proof — CONFIRMED empirically.** Stashed the tracked refactor (reversibly), ran
  `tests/workflow-authority-removal.test.ts` against base source → **3/3 FAIL** (EXIT 1):
  `CanonicalWorkflowClient is not a constructor`; `requestApproval` did **not** throw (stored in Map);
  break-glass threw `MUTATION_CONTAINMENT_ACTIVE` instead of `/disabled|manual-gate/`. Restored the
  stash; worktree status verified byte-identical to before (12 files), stash list empty.
- **GAP-3 — `.env.example`:** exists but still base content; **missing** the item-7 mandated
  `SANGFOR_ROOT_URL`, `INTERNAL_PRINCIPAL_TTL_SECONDS`, `INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS`,
  `INTERNAL_PRINCIPAL_ROTATION_OWNER`, `INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID`,
  `INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON` and the fixed issuer/audience/service/capability list.
- **GAP-4 — item-9 lifecycle tests absent:** `workflow-engine.test.ts` only adds a `mkdtemp`
  `OperationOrchestrator`+`PostVerifier(outputRoot)` case. It does **not** contain the mandated
  child-process **SIGINT/SIGTERM** cleanup fixture, the `outputs/evidence`/`outputs/verification`
  before/after boundary snapshots, or an explicit "construct-without-root fails before write"
  assertion. Those "Required assertions" are unproven.
- **GAP-5 — U026 byte-compat / root round-trip unproven:** `canonical-workflow-client.test.ts` only
  checks fail-closed + one route binding against a mock `fetch`. There is **no** test validating the
  U026 envelope byte-for-byte against root verifier fixtures, and **no** isolated-PG canonical
  round-trip / mock-root "Real surface QA" was implemented or run (no such test file exists; Docker
  was available but there was nothing to exercise).

## Check 4 — LEAKS (PASS, with dead-code note)

- No Docker containers were started by this verification; no port/process leaks.
- Worktree diff remains exactly the 12 owned files (verified before/after the red-first stash).
- **Dead code left in tree** (not a leak, but "disabled by un-wiring" rather than "removed"):
  `apps/mcp-server/src/tools/workflow-tools.ts` (approvedBy tool), `tool-catalog.ts`, `tool-context.ts`
  (5 `new Map()`), `apps/operator-console/src/routes/workflow-routes.ts`, `server-context.ts` Maps.
- **Latent runtime regression (out of boundary):** `packages/workflow-engine/src/sangfor-intelligence.ts:85`
  still constructs `new DeviceVerifier({ outputDir })` without `outputRoot` → the new fail-closed
  constructor now **throws at construction**. Unexercised by any test (no `new SangforIntelligence`),
  but any future consumer of `SangforIntelligence` would break.

---

## Is statelessness genuinely enforced?

**For the workflow-engine and the MCP tool surface — yes.** The engine holds no authoritative
workflow/approval/break-glass state (all Maps/timers removed; mutators throw; reads empty), delegation
goes through a real `CanonicalWorkflowClient` that fails closed, and the live MCP entrypoint exposes
zero tools so the residual self-approval tool code is unreachable. Executable mutation, device access,
break-glass, and remediation are all fail-closed (403) end-to-end.

**Service-wide — not fully.** The operator console still mounts `registerAutoOpsRoutes`, a live local
operation-approval authority (`/api/plan`, `/api/approvals`, `/api/approvals/:id/approve|reject`) that
writes local approval history to in-memory Maps — matching the dispatch's own "confirmed defect" but
sitting outside U028's declared file boundary. It grants no root-bypassing action (all executions are
denied) and takes `approvedBy` from server identity, so it is a non-executable residual surface rather
than a live bypass — but it means "the service owns no approvals" is not literally true.

## Recommendation before sealing

1. Remove/disable the auto-ops local approval surface (`/api/plan`, `/api/approvals*`) and the
   `operationPlans`/`approvals` Maps, or route them through the canonical root — this requires widening
   the U028 file boundary to `auto-ops-routes.ts` + `server-context.ts` (raise a boundary amendment).
2. Wire `canonical-workflow-client.test.ts` into the vitest `include` (or relocate it under `tests/`)
   so the acceptance command actually executes it.
3. Add the item-7 U026 env placeholders + capability list to `.env.example`.
4. Implement the item-9 SIGINT/SIGTERM cleanup + outputs-boundary snapshot tests and a real U026
   byte-compat / mock-root+PG round-trip (the "Required assertions" / "Real surface QA").
5. (Minor) resolve the latent `SangforIntelligence`→`DeviceVerifier` construction break.

---
*Verifier: fresh non-author agent (Opus 4.8). Evidence logs under `/tmp/u028-*.log`.*
