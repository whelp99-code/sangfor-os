# Design: Separate MCP & Vibe-Coding out of sangfor-os

**Date:** 2026-07-01
**Status:** Approved (brainstorming) — pending spec review
**Author:** whelp99-code (with Claude)

## Goal

Split the `sangfor-os` monorepo into a clean body plus two extracted concerns, so
each evolves and deploys independently. End state is **conceptually three things**
(os, MCP, vibe-coding); physically four git repos because MCP keeps its two
original repos separate.

```
/Users/jmpark/Playground/
  sangfor-os/                          (body — MCP/vibe references removed)
  whelp99-code-sangfor-engineer-mcp/   (MCP service #1 — existing original repo, adopted)
  sangfor-mcp-workflow/                (MCP service #2 — existing original repo, adopted)
  sangfor-vibe-coding/                 (NEW — empty skeleton only)
```

`sangfor-os` ↔ MCP communicate **only over HTTP (env-configured URLs)**. No code
or filesystem dependency remains between them.

## Key facts that shaped this design

- The two MCP services were *copied into* `sangfor-os/services/*`. Their **original
  repos already exist** with full history:
  - `whelp99-code-sangfor-engineer-mcp` — 38 commits; code is **byte-identical** to
    the copy (the copy only *added* Docker wrappers).
  - `sangfor-mcp-workflow` — 43 commits; copy differs in **5 files**
    (`apps/operator-console/src/server.ts`, `…/bootstrap/mcp-bootstrap.ts`,
    `package.json`, `apps/operator-console/Dockerfile`, `AGENTS.md`) plus minor
    side files.
- `@sangfor/infra` MCP clients are **pure env-URL** based (no filesystem coupling):
  - `mcp-client.ts` → `WHELP99_MCP_HTTP_URL` / `getUrl('WHELP99_MCP_BRIDGE')`
  - `engineer-console.ts` → `WHELP99_OPERATOR_CONSOLE_URL` / `getUrl('WHELP99_OPERATOR_CONSOLE')`
- `HEALTH-REGISTRY.yaml` **already points at the external original paths**
  (`~/Playground/sangfor-mcp-workflow`, `~/Playground/whelp99-code-sangfor-engineer-mcp`).
- `docker-compose.yml`: the MCP/vibe blocks to remove only depend on each other
  (`sangfor-mcp-workflow → sangfor-engineer-mcp`). `caddy` depends only on
  `api` + `web`. So removal leaves **no dangling `depends_on`**.
- `@sangfor/agent` (business workflow orchestration) and `@sangfor/infra` (HTTP
  clients + health probe) **stay in `sangfor-os`** — they are NOT part of "MCP"
  or "coding" and are consumers, not the extracted concern.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|---|---|
| Boundary | What is extracted | MCP (real) + vibe-coding (skeleton only) |
| MCP structure | One combined repo vs keep originals | **(나) Keep the two original repos as-is — no graft/merge** |
| History | Preserve vs fresh | Preserve — by **adopting the originals** (full history) |
| Delta reconciliation | Originals vs copy | **(a) Originals = source of truth; re-apply the copy's integration deltas on top** |
| Repo form | Monorepo vs separate repos | Separate git repos, sibling dirs under `/Users/jmpark/Playground/` |
| Names | New vs original | **Keep original names** |
| Vibe-coding | Source | **(c) Remove stub/refs from os; create empty skeleton only** |
| GitHub remote | Now vs later | **Not needed — local repos only** |
| Compose blocks | Remove vs keep-as-reference | **Fully remove** MCP/vibe blocks from `sangfor-os` |

## Work breakdown

### A. Adopt MCP originals (re-apply integration deltas)
Operate on the existing original repos in place; commit the deltas so they become
the canonical, deployable MCP.

1. **`whelp99-code-sangfor-engineer-mcp`**: copy in the Docker/integration files
   that exist only in `sangfor-os/services/sangfor-engineer-mcp` — `Dockerfile`,
   `Dockerfile.mock`, `docker-entrypoint.sh`, `.dockerignore`. Commit.
2. **`sangfor-mcp-workflow`**: for each of the 5 differing files, diff
   copy-vs-original and apply the integration-specific changes from the copy onto
   the original. Commit.
3. Confirm each repo starts independently (its own `docker-compose.yml` /
   dev scripts) and serves health endpoints.

> Note: "history preserved" = the originals' own history (38 / 43 commits). The
> copy-in history inside `sangfor-os` is discarded (it was a bulk copy).

### B. Clean `sangfor-os` (branch `chore/extract-mcp-vibecoding`)
1. **Delete** `services/sangfor-engineer-mcp/`, `services/sangfor-mcp-workflow/`.
2. **`docker-compose.yml`**: remove blocks `sangfor-engineer-mcp`,
   `sangfor-mcp-workflow`, `sangfor-mcp-mock-console`, `sangfor-mcp` (placeholder),
   `vibe-coding` (placeholder). Leave `api/web/caddy/postgres/...` intact.
3. **Keep** `@sangfor/infra` (mcp-client, engineer-console, integration health
   probe) and `@sangfor/agent`. Keep URL config in `config/ports.ts` +
   `config/schema.ts` (still needed to reach external MCP).
4. **Document** MCP URLs in the env example so the portal points at the external
   MCP services.
5. **Update** references: `scripts/start-integration-stack.{mjs,sh}`,
   `scripts/stack.sh`, `Makefile`, dispatch-opencode scripts, `PORT-MAPPING.yaml`,
   `HEALTH-REGISTRY.yaml` (external paths — keep/verify), `ARCHITECTURE.md` source
   table (mark MCP as external repos).
6. **Remove vibe-coding refs**: `packages/proxy-core/src/types.ts` (`'vibe-coding-os'`
   union member), `packages/auth/src/token-manager.ts` (registry entry),
   `PORT-MAPPING.yaml` vibe entry, any config.

### C. Create `sangfor-vibe-coding` skeleton (local repo)
Minimal: `README.md`, `package.json`, `.gitignore`, `src/` placeholder. Content
deferred. `git init`, initial commit, no remote.

## Verification

- **MCP repos**: start each independently → health endpoints return 200
  (engineer bridge 3600 / operator console 3502; workflow console 3500;
  mock 3400 if used).
- **sangfor-os**: with MCP URLs pointing at the external services,
  `GET /api/mcp/tools` lists tools, integration health probe is green, and
  `@sangfor/agent` unit tests pass. `docker compose config` is valid (no dangling
  refs). Build/typecheck unaffected by the removals.
- **vibe-coding**: repo exists, initial commit present.

## Non-goals

- No combining of the two MCP repos into one.
- No git history graft/merge.
- No vibe-coding feature implementation (skeleton only).
- No extraction of `@sangfor/agent` or `@sangfor/infra` (they stay).
- No GitHub remotes.

## Risks / open points

- **mcp-workflow 5-file delta direction**: must inspect each diff at implementation
  time to apply only the *integration* changes (not unrelated drift). Resolved per
  file during the plan.
- **sangfor-os dev ergonomics**: after removal, running the full stack locally
  requires starting the external MCP repos separately. The updated
  `start-integration-stack` script should orchestrate or document this.
- **Stale references**: grep sweep after cleanup to ensure no remaining
  `services/sangfor-*-mcp` / `vibe-coding` paths break build or scripts.
