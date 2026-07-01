---
name: round
description: Run one improvement round on an isolated worktree — parallel file-scoped agents → verify → PR with auto-merge → sync. Use when iterating fix/cleanup rounds against a codebase (the pattern refined across the 22-round improvement loop). Also for any "loop until converged" audit-and-fix work.
---

# /round — one improvement round, the efficient way

Encodes the workflow refined over 22 improvement rounds so you don't hand-roll
the boilerplate (worktree, parallel agents, CI polling, PR, sync) every time.

## When to use
- Iterating fix/cleanup/i18n/a11y/security rounds against this repo.
- Any "find issues → fix in parallel → verify → merge → re-audit until zero" loop.

## The one-round loop

### 1. Isolate (never touch the shared checkout)
The main checkout may be shared by other sessions. Always work in a fresh worktree off the latest main:
```bash
git fetch origin main --quiet
git worktree add .worktrees/round -b improve/round-N origin/main
cd .worktrees/round && pnpm install --prefer-offline
```
Reset an existing round worktree instead of re-creating: `git switch improve/round-1 && git reset --hard origin/main`.

### 2. Fan out — parallel agents, split by FILE RANGE (not by topic)
Give each subagent a **disjoint file set** so they never conflict. Put the
exact files + the fix + "don't touch other files" in each prompt. 2–4 agents is
the sweet spot. Each agent must end with `pnpm --filter web exec tsc --noEmit -p tsconfig.json`
(and `@sangfor/api` / `@sangfor/business` as relevant) and report errors=0.

> For deterministic loop-until-dry orchestration (fan-out → verify → converge in
> one call), prefer the **Workflow tool** over hand-spawning agents — it is built
> for exactly this and removes the manual round bookkeeping.

### 3. Bring up the app + verify (scripted — no manual port dance)
```bash
scripts/dev-up.sh          # postgres + api(:3200) + web(:3101), handles ulimit/WATCHPACK/AUTH_BYPASS
scripts/dev-smoke.sh       # key routes 200/307
```
Typecheck all touched packages. Run tests: `pnpm --filter web exec vitest run`.
Finance/integration tests need a live DB + `CI_INTEGRATION=1` — run those before
committing (local DB can drift; the clean CI is the source of truth).

### 4. Ship — one command, auto-merge (no CI polling)
```bash
scripts/round-ship.sh improve/round-N "fix(round-N): <summary>" "<body>"
```
This commits, pushes, opens the PR, and enables `gh pr merge --auto --squash --delete-branch`.
GitHub merges the moment required checks go green — **do not sit in a `sleep` poll loop**.
(Requires branch protection with required checks on main; see docs/DEV_REFERENCE — Auto-merge.)

### 5. Re-audit → converge
After merge, reset the worktree to the new main and spawn a **fresh audit agent**
(or `/code-review`, `/security-review`, or an `oma-qa` pass) to find the next
round's work. Stop when a strict audit reports **zero reachable defects** across
security / finance / i18n / a11y / perf / functional / quality. Exclude false
positives explicitly (product proper nouns, enum codes, unimported components,
read-open GETs, mock/demo screens).

## Guardrails (learned the hard way)
- **Isolated worktree only** — other sessions share the main checkout; never `git switch`/`reset` it.
- **File-scoped agents** — disjoint file sets prevent merge conflicts between parallel workers.
- **Honest empties over fake data** — never render placeholder numbers as if real.
- **Verify against clean CI**, not a drifted local DB.
- **`scripts/dev-up.sh`** handles EMFILE (`ulimit -n`), watcher flakiness (`WATCHPACK_POLLING`), and the finance dev bypass — don't reinvent it.
