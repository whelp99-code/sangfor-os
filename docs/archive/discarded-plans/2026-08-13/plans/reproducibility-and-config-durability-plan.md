# Reproducibility & Config Durability Plan

> Scope: make the MCP/console runtime (ports 3400/3500/3502/3600 + deps) come up
> **identically and durably on any machine, with one command**, and stop infra
> config edits from silently disappearing.
>
> Trigger: the Operator dashboard showed all MCP services as "연결불가". They were
> simply not running, and every durable fix to `docker-compose.yml` /
> `Dockerfile` was reverted within the session. This document is the evidence
> (Part A — audit) and the remediation plan (Part B).
>
> Status: DRAFT · Owner: TBD · Date: 2026-06-28

---

## Part A — Audit findings (evidence)

### A0. Root cause of the "config keeps reverting" problem ⭐
This was the user's central question. It is **not** a linter or a hook.

**Evidence**
- After editing `docker-compose.yml` (added `command:` override) and
  `services/sangfor-engineer-mcp/Dockerfile` (changed `CMD`), both files reverted
  to the committed HEAD: `git status --short` returns empty for both.
- The untracked file `docker-entrypoint.sh` (`??`) **survived**; only tracked-file
  edits reverted. That selective behavior is the signature of
  `git checkout .` / `git reset --hard` / `git stash`, **not** a formatter.
- The repo has **7 git worktrees** and **4 concurrent `claude --dangerously-skip-permissions`
  processes** (PIDs 7127 / 79424 / 34159 / 82257) running in parallel.
- The main working directory is currently checked out on branch **`test-cfo-matching`**,
  not `main`. `git reflog` shows mid-session `checkout`/`commit`/`reset` activity from
  the parallel CFO automation.

**Conclusion:** the single shared working directory is being mutated by multiple
automation agents that switch branches, commit, and reset concurrently. Any
**uncommitted** infra edit in the working tree gets clobbered. Durability cannot
be achieved by editing tracked files in place — the change must be **committed on
its own branch / PR**, and the reproducible bring-up must not depend on
uncommitted working-tree state.

### A1. The 4 services are absent from the default bring-up
`pnpm docker:dev` = `docker compose up -d postgres redis` only. The bridge (3600),
operator console (3502), workflow console (3500) and mock console (3400) are never
started by any documented command. "연결불가" is the expected state, not a bug.

### A2. The engineer-mcp image only starts the bridge (3600), not the console (3502)
`services/sangfor-engineer-mcp/Dockerfile` `CMD` runs `apps/http-bridge` only.
3502 (`apps/operator-console`) is a separate process the container never launches,
even though compose maps `3502:3502` and sets `OPERATOR_CONSOLE_PORT`.
Fixed this session via `docker-entrypoint.sh` (runs both) — but see A0.

### A3. The workflow console (3500) image cannot build
`services/sangfor-mcp-workflow/package.json` declares
`"@sangfor/chrome": "file:../sangfor-engineer-mcp/packages/sangfor-chrome"` — a
`file:` link **outside** the Docker build context (`./services/sangfor-mcp-workflow`).
`pnpm install` fails: `ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND`. The console app itself
does not import `@sangfor/chrome` (only `scripts/lib/*` do).

### A4. Duplicate copies of the same service + hardcoded stale paths
`scripts/start-integration-stack.mjs` defaults to **external sibling clones**:
`WHELP99_PATH || ~/Playground/whelp99-code-sangfor-engineer-mcp` and
`SANGFOR_PATH || ~/Playground/sangfor-mcp-workflow`. The workflow console's MCP
bootstrap (`apps/operator-console/src/bootstrap/mcp-bootstrap.ts`) defaults to
`~/Documents/Playground/whelp99-code-sangfor-engineer-mcp`. So the same services
exist as (a) in-monorepo `services/*` and (b) one or more external clones, and
different tools pick different copies. This is why 3500 connected to a stale clone
and fell back to MCP **stub** mode.

### A5. Host environment is unprovisioned for the spawned MCP server
Running the engineer-mcp MCP server on the host crashed twice before working:
missing `pptxgenjs` (needed `pnpm install`) and ungenerated Prisma client
(`@prisma/client` has no `PrismaClient` export → needed `pnpm exec prisma generate`).
Inside the container these are done at build time; on the host nothing provisions them.

### A6. Bring-up tooling is fragmented (no single source of truth)
At least 5 overlapping entrypoints: `scripts/start-integration-stack.{mjs,sh}`,
`scripts/start-system.sh`, `scripts/launch-aios-v1-stack.sh`, `scripts/setup-dev.sh`.
No `Makefile`/`justfile`. `launch-aios-v1-stack.sh` hardcodes
`/Users/jmpark/Playground/AIOS v1` and opens Terminal windows via `osascript` —
machine- and user-specific.

### A7. Mock and real services share one plane
`docker-compose.yml` defines `sangfor-mcp`, `vibe-coding`, `mail-intelligence` as
`node -e` one-liners that return a static `200 {status:'ok'}`. These sit next to
real services, so "green" does not imply "working" (observed: `finance` shows
장애 while the dashboard frame is healthy).

### A8. Doc/runtime drift
`w1-w2-stabilization-runbook.md` references `FINANCE_URL=http://localhost:4100`,
but compose comments say the standalone finance service was removed and is now
served by `api` at `:3200/api/cfo`. Health checks point at a port nothing serves.

### A9. Node version mismatch
Services declare `engines.node >=22`; host runs v20.20.2 (warning only, currently works).

---

## Part B — The plan (make it reproducible & durable)

### Guiding principles
1. **One command, any machine.** `make up` (or `pnpm stack:up`) brings the whole
   runtime to all-green, idempotently.
2. **No dependency on uncommitted working-tree state.** Because concurrent agents
   reset the tree (A0), every config change ships as a committed PR, and bring-up
   reads only committed files + a dedicated, well-known path.
3. **One copy of each service.** The in-monorepo `services/*` is canonical; external
   sibling clones are removed from all defaults.
4. **Green means working.** Health checks verify real dependencies, and mock
   services are clearly labeled.

### P0 — Stop the bleeding (durability) — ~0.5 day
- **Branch + PR for all infra config.** Create `feat/mcp-runtime-reproducible`,
  commit the 3502 entrypoint fix (A2), the `command:` override or Dockerfile `CMD`,
  the `.env` `SANGFOR_MCP_CWD` correction (A4), and the host start script. A
  committed change on a branch is immune to the concurrent-reset problem (A0).
- **Document the shared-workspace hazard** in `CONTRIBUTING`/runbook: concurrent
  agents reset the working tree; never rely on uncommitted edits; do infra work on
  a branch. Consider giving long-running infra work its own `git worktree`.
- Re-apply and verify the two reverted edits (Dockerfile `CMD` / compose `command:`)
  on the branch, then confirm `git status` keeps them after a simulated branch switch.

### P1 — Single canonical bring-up + deep health — ~1–1.5 days
- **Add a `Makefile`** (or `pnpm stack:up`/`stack:down`/`stack:status`) as the one
  entrypoint. It must:
  - `docker compose up -d postgres redis sangfor-engineer-mcp sangfor-mcp-mock-console`
  - provision + start the host workflow console via
    `services/sangfor-mcp-workflow/start-console.sh` (A3/A5)
  - block until all health endpoints return 200 (reuse this session's probe loop).
- **Deepen health checks (A7).** Each `/health` reports real status of its
  dependencies (DB reachable, MCP `connected` vs `stub`, LLM endpoint), not a bare 200.
- **Deprecate the redundant scripts (A6).** Keep one; make the others print
  "use `make up`" and exit, or delete after migration.

### P2 — Collapse duplicate copies & kill hardcoded paths — ~1 day
- **Make `services/sangfor-engineer-mcp` the single source.** Default
  `SANGFOR_MCP_CWD` and `start-integration-stack.mjs`'s `WHELP99_PATH`/`SANGFOR_PATH`
  to the in-repo path; remove the `~/Documents/...whelp99-code...` and
  `~/Playground/...` defaults (A4). Fail loudly if the path is missing instead of
  silently falling back to stub.
- **Fix the 3500 build context (A3)** so the image builds OR commit to host-run as
  the supported path. If containerizing: raise the build context to `services/` and
  fix COPY paths, or drop `@sangfor/chrome` from the console's prod dependency set
  (it is unused by the app). Recommendation: **host-run is simpler** given the
  stdio-subprocess design — formalize it rather than fight the build.
- **Provision host deps in bring-up (A5):** `make up` runs `pnpm install` +
  `pnpm exec prisma generate` for `services/sangfor-engineer-mcp` if missing.

### P3 — Trust & drift control — ~1 day
- **Label mock vs real (A7).** Tag the `node -e` stubs in compose with a `mock`
  profile and surface a mock/real badge on the dashboard.
- **Fix doc/runtime drift (A8):** update the runbook's finance URL/port to
  `:3200/api/cfo`; align `health-check.sh`.
- **Pin Node (A9):** add `.nvmrc`/`engines` enforcement or document v22 as required;
  CI runs on v22.
- **CI smoke:** a job that runs `make up` against a clean checkout and asserts all
  four endpoints + deep health are green — this is the regression guard for the
  whole plan.

### Acceptance criteria
- [ ] On a fresh clone, `make up` brings 3400/3500/3502/3600 to 200 with no manual steps.
- [ ] Workflow console reports `MCP: connected` (not stub) by default.
- [ ] All infra config lives in committed files; a concurrent branch switch/reset
      no longer changes runtime behavior.
- [ ] Health endpoints reflect real dependency status; mock services are labeled.
- [ ] Exactly one documented bring-up path; redundant scripts removed/redirected.
- [ ] CI asserts the all-green state on a clean checkout.

### Risks & notes
- **Concurrent agents (A0) remain the top hazard.** Even after P0, other sessions
  can reset the tree mid-work. Mitigation: do infra work in a dedicated worktree and
  land it fast; treat `main` as the only trusted state.
- **Host-run vs full containerization (A3)** is a deliberate trade-off; this plan
  recommends host-run for 3500 to avoid the cross-context build, accepting that it
  needs host provisioning (P2).
- Effort is rough (~4–5 days total) and assumes no deeper coupling surfaces during P2.

---

### Appendix — current working bring-up (this session, pre-Makefile)
```bash
# containers: bridge (3600) + console (3502) + mock (3400)
docker compose up -d sangfor-engineer-mcp sangfor-mcp-mock-console
# host: workflow console (3500), MCP connected (needs .env SANGFOR_MCP_CWD + provisioned deps)
services/sangfor-mcp-workflow/start-console.sh
```
Note: the engineer-mcp container needs `docker-entrypoint.sh` as its command to run
both 3600 and 3502 (see A2). That override currently lives in an untracked script +
a compose/Dockerfile edit that must be committed (P0) to survive.
