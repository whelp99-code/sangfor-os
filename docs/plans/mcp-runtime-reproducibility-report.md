# MCP Runtime Reproducibility — Delivery Report

> What was done, why, and how to operate the result. Companion to the plan in
> [`reproducibility-and-config-durability-plan.md`](./reproducibility-and-config-durability-plan.md).
>
> Date: 2026-06-28 · Status: **DONE** (P0–P3 + optional follow-ups merged)

---

## TL;DR

The Operator dashboard showed every MCP service as **연결불가**. Root cause: the
services simply weren't running, and the engineer-mcp image only started the
bridge, not the console. Beyond the immediate fix, the bring-up was not
reproducible — duplicate service copies, hardcoded stale paths, an unbuildable
image, and config edits that kept disappearing.

Delivered, across 3 merged PRs:

| PR | Merge | Scope |
|---|---|---|
| [#21](https://github.com/whelp99-code/sangfor-os/pull/21) | `1c912fcc2` | **P0+P1+P2** — durable bring-up, `make up`/`status`/`down`, single in-repo service source |
| [#26](https://github.com/whelp99-code/sangfor-os/pull/26) | `c988b14de` | **P3** — CI smoke, mock profiles, doc/runtime drift, Node pin (+ a real container-build bug the smoke caught) |
| [#29](https://github.com/whelp99-code/sangfor-os/pull/29) | `f0f2126a5` | **Optional follow-ups** — `make` as single entrypoint, deeper 3500 health |

Net result: `make up` brings 3400/3500/3502/3600 to all-green on any machine,
`make status` does a real dependency check, and a CI smoke guards regressions.

---

## 1. Starting point & diagnosis

The dashboard (`/operator`) and the Tools page (Phase 3 Registry) reported
`연결불가` / `fetch failed` for the MCP bridge (`:3600`), workflow console
(`:3500`), engineer operator console (`:3502`), and mock console (`:3400`).

**It was not a connection bug.** `docker ps` + port probes showed only
`postgres`/`redis` running; ports 3400/3500/3502/3600 weren't listening at all,
so every probe got a connection refusal (`000`). The dashboard and bridge code
were fine — there was nothing to connect to.

Immediate recovery brought all four to `200`:
- Started the prebuilt `sangfor-engineer-mcp` + `sangfor-mcp-mock-console` containers.
- Discovered the engineer-mcp image only runs the bridge (3600); started the
  operator console (3502) manually.
- The workflow console (3500) image can't build → ran it on the host.

That exposed deeper, systemic fragility, which became the work below.

## 2. Root causes (audit)

Full detail in the plan (findings A0–A9). The decisive ones:

- **A0 — config edits kept reverting.** Not a linter/hook. Multiple concurrent
  `claude` automation sessions (4 processes, 7 worktrees) reset/branch-switch
  the **shared** working tree; uncommitted infra edits get clobbered (tracked
  files reverted, untracked survived = the signature of `git checkout`/`reset`).
  Consequence: **durable fixes must be committed on a branch**, not edited in place.
- **A2** — engineer-mcp image CMD starts only the bridge, never the 3502 console.
- **A3** — workflow console (3500) image can't build: an `@sangfor/chrome`
  `file:` link points outside the Docker build context.
- **A4** — the same service exists both in-repo (`services/*`) and as external
  sibling clones; tools picked different copies, so 3500 connected to a stale
  `~/Documents/...` clone and fell back to MCP **stub**.
- **A5** — host engineer-mcp was unprovisioned (`pptxgenjs` missing, Prisma
  client not generated) → spawned MCP server crashed.
- **A6** — five overlapping bring-up scripts, no single source of truth.
- **A7** — static `200` stub services mixed with real ones ("green ≠ working").
- **A8/A9** — doc/runtime drift (finance `:4100`) and Node version mismatch.

## 3. What was delivered, by phase

### P0 — Stop the bleeding / durability (PR #21)
- `docker-entrypoint.sh`: run bridge (3600) **and** operator console (3502) in
  one container; wired via Dockerfile `CMD` **and** a compose `command:`
  override (the override is the durable one).
- `start-console.sh`: host bring-up for the workflow console (3500); restartable,
  waits for health.
- All committed on a branch — immune to the A0 concurrent-reset problem.

### P1 — Single entrypoint + deep health (PR #21)
- `scripts/stack.sh {up|down|status|provision}` + a thin `Makefile`.
- `make up` = start containers → provision host engineer-mcp deps
  (`pnpm install` + `prisma generate`) → start host workflow console → wait for health.
- `make status` = **deep** check: endpoint 200s **plus** `pg_isready`, redis
  `ping`, and the workflow console's MCP mode (connected vs stub).

### P2 — One service source, no stale paths (PR #21)
- `mcp-bootstrap.ts`: default MCP cwd to the in-repo sibling
  `services/sangfor-engineer-mcp` (was a hardcoded `~/Documents` clone) — the
  console now connects for real with **no `.env` override**.
- `start-integration-stack.mjs`: default the sangfor service paths to in-repo
  `services/*` (env still overrides).

### P3 — Trust & drift control (PR #26)
- **CI smoke** (`.github/workflows/stack-smoke.yml`): builds + starts the
  container stack and asserts bridge (3600) + console (3502) + mock (3400).
- **Mock/real boundary**: the static-200 stubs are behind a `mock` compose
  profile, so a plain `docker compose up` never starts a misleading green stub.
- **Doc/runtime drift**: finance is `:3200/api/cfo` (the `:4100` service was
  removed); `health-check.sh` + the W1-W2 runbook now point there. Verified live.
- **Node pin**: `.nvmrc` = 20 (matches host + CI; containers pin node:20 too).

### Optional follow-ups (PR #29)
- **A6 done right**: the 5 scripts are *different layers*, not duplicates, so
  deletion was wrong. Instead `make` is the single discoverable entrypoint —
  `make help`, plus `make app` (api/web) and `make integration` delegating to
  the existing scripts; `scripts/README.md` maps each one. De-hardcoded
  `launch-aios-v1-stack.sh` (`/Users/jmpark/...` → `$HOME` + env overrides).
- **Per-service deep health**: bridge 3600 and console 3502 were already deep;
  the workflow 3500 `/api/system/health` hardcoded `status:'ok'` even in stub
  mode → now reports `status: ok|degraded` + a `checks` object (HTTP stays 200).

## 4. Notable incident — the smoke caught a real bug

On its first run the new `stack-smoke` job **failed**, and it was right to: a
clean build of the engineer-mcp image crashed its spawned MCP server with
`Cannot find package 'pptxgenjs'`, cascading to the bridge `/health` (which
calls MCP `tools/list`) so 3600 never went green.

Root cause was **not** a Node version: the multi-stage Dockerfile copied only the
root `node_modules`, then `COPY . .` laid down `packages/*` without the
per-package pnpm symlinks (e.g. `packages/sangfor-pptx/node_modules/pptxgenjs`),
so the bare `import 'pptxgenjs'` couldn't resolve. Fix: re-run `pnpm install` in
the runner stage after `COPY . .` (relinks against the copied store) + a
`.dockerignore`. Validated locally on a fresh image, then green in CI.

This is exactly the value the smoke was meant to provide — a disguised
reproducibility defect, caught automatically.

## 5. How to operate it now

```bash
make help            # list all targets
make up              # MCP runtime → all-green (3400/3500/3502/3600)
make status          # deep health: endpoints + pg/redis + MCP mode
make down            # stop containers + host workflow console
make app             # app stack (api/web/postgres/redis)
make integration     # full integration stack (upstreams + portal)
docker compose --profile mock up   # explicitly start the static-200 stubs
```

`make status` healthy output:
```
✓ bridge:3600 200   ✓ console:3502 200   ✓ mock:3400 200   ✓ workflow:3500 200
✓ postgres accepting   ✓ redis PONG   ✓ workflow MCP connected
```

## 6. Artifact inventory

Added:
- `Makefile`, `scripts/stack.sh`, `scripts/README.md`, `.nvmrc`
- `.github/workflows/stack-smoke.yml`
- `services/sangfor-engineer-mcp/docker-entrypoint.sh`, `.dockerignore`
- `services/sangfor-mcp-workflow/start-console.sh`
- `docs/plans/reproducibility-and-config-durability-plan.md` (+ this report)

Changed:
- `docker-compose.yml` (engineer-mcp `command:` override; `mock` profiles)
- `services/sangfor-engineer-mcp/Dockerfile` (runner re-install; node:20)
- `services/sangfor-mcp-workflow/apps/operator-console/src/bootstrap/mcp-bootstrap.ts`
  (in-repo MCP cwd default) and `.../server.ts` (honest `/api/system/health`)
- `scripts/start-integration-stack.mjs`, `scripts/launch-aios-v1-stack.sh`,
  `scripts/health-check.sh`, `docs/12_VERIFICATION/w1-w2-stabilization-runbook.md`

## 7. Outcome & possible future work

**Outcome:** one-command, reproducible bring-up on any machine; real health
visibility ("green = working"); infra config durable against concurrent-agent
resets; a CI guard against regression.

**Not in scope / future (from the broader 고도화 discussion):** containerizing
the 3500 workflow console (currently host-run by design), per-service health in
the CI smoke (3500 is exercised locally only), agent-output verification loops,
and mail-learning governance (source/PII/confidence). See the 고도화 notes.
