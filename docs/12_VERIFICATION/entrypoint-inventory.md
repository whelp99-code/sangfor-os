# Entrypoint inventory — root / engineer / workflow (U008)

This document is the human-readable companion to `entrypoint-inventory.json`. The JSON file
is authoritative; this file summarizes it and explains how it is produced and validated.

## What this is

A trackable inventory of the real entrypoints of the three independent workspaces
(`root`, `services/sangfor-engineer-mcp` as `engineer`, `services/sangfor-mcp-workflow` as
`workflow`), plus every current Knip-flagged unused-code candidate, each with an owner,
disposition, concrete reason, and expiry/review-unit. This card creates evidence; it does
**not** delete anything. Any file, export, or dependency in this inventory with
`disposition: "candidate_for_U030"` is an input to U030's future deletion decision, not a
decision itself.

## How it is produced (dispatch point 7 — no copied audit artifacts)

`scripts/check-entrypoint-inventory.mjs` exports pure discovery functions
(`discoverRootUsed`, `discoverEngineerUsed`, `discoverWorkflowUsed`) that re-scan the current
tree directly:

- **root**: Next.js App Router `page.tsx`/`route.ts` files under `apps/web/src/app`, package
  `exports`/`main` targets from each `packages/*/package.json`, CLI scripts directly under
  `scripts/`, the Prisma schema/seed/migrations directory, and Playwright/Vitest configs.
- **engineer**: the four `apps/*/src/{index,server}.ts` process entrypoints, CLI scripts
  directly under `scripts/`, the MCP tool catalog (every key of the `tools` Record in
  `apps/mcp-server/src/index.ts`, the same object `tools/list` and `tools/call` both key off),
  the two operator-console route/UI modules, the `sangfor-pptx` package export, the Prisma
  schema, and the Vitest config.
- **workflow**: the two `apps/*/src/{index,server}.ts` process entrypoints, the operator
  console route and bootstrap modules, the MCP tool catalog (every key exported by
  `createXTools()` in `apps/mcp-server/src/tools/*.ts`), package `exports` targets from each
  `packages/*/package.json`, CLI scripts directly under `scripts/`, and the Vitest config.

Candidate (`candidate_for_U030`) entries come from a Knip baseline scan per workspace
(`knip --reporter json`) captured against candidateSha `2499a2b343a3c28a7e6f437a804c0f40afede75b`,
transformed 1:1 into inventory records — no `.omo` audit output was used as a source.

## U030 removal receipt

U030 removed the 18 source candidates, the zero-consumer UI package, the unused shared
tracing export/dependencies, and the workflow backup after the amended planned-owner scan.
The scan found no U031–U076 owner for a deleted path; it retained
`customers-data-table.tsx` (U062), `role-dashboard.tsx` (U063), and
`edit-opportunity-form.tsx` (U043) as protected fixtures.

## How it is validated (dispatch points 5, 6, 8)

`node scripts/check-entrypoint-inventory.mjs`:

1. Re-validates the U007 dual-receipt pre_u030 prerequisite first (via
   `scripts/check-release-state-receipts.mjs --phase pre_u030`, reused as an external
   process, plus this unit's own symlink / path-escape / ancestor-of-HEAD checks). Any
   failure exits 64 before anything below runs.
2. Re-derives the "used" surface from the live tree and diffs it against this file's `used`
   entries — any addition or removal is reported as drift.
3. Cross-references every `knip.json` `ignore` / `ignoreDependencies` / `ignoreIssues` /
   `ignoreUnresolved` exception (in all three workspaces) against a `candidate_for_U030`
   record with a non-wildcard exact path/name, a real `owner`, a concrete `reason`, and a
   non-expired `expiry`/review-unit.
4. Rejects stale candidate paths (file no longer exists), ambiguous cross-workspace
   ownership (same physical file claimed by two workspaces), and structurally incomplete
   entries.
5. Writes the point-10 `cleanup` object (`cleanup.json`) — this unit starts no runtime
   resource, so every field is the literal string `"N/A"`.

`scripts/check-entrypoint-inventory.test.mjs` covers the full failing-first list with
`node:test`, using only OS `mkdtemp`-owned temporary fixtures (no new tracked fixture paths).

## Current counts (candidateSha `2499a2b343a3c28a7e6f437a804c0f40afede75b`)

| | total | used | candidate_for_U030 |
|---|---|---|---|
| root | 459 | 306 | 153 |
| engineer | 134 | 113 | 21 |
| workflow | 74 | 60 | 14 |
| **all** | **667** | **479** | **188** |

"0 unexplained" (what `knip:check` reports today) is not the same thing as "0 total
candidates" (what the table above reports): every one of the 188 `candidate_for_U030` rows
is a real, currently-explained Knip finding kept alive as U030 input, not a claim that
nothing is unused.

## Where the Knip config lives

Three independent baselines, matching the three independent workspaces:

- `knip.json` (root)
- `services/sangfor-engineer-mcp/knip.json`
- `services/sangfor-mcp-workflow/knip.json`

Each workspace's `package.json` carries `knip` (run once, human-facing), `knip:baseline`
(`knip --no-exit-code`, always exit 0, for reporting), and `knip:check` (`knip`, the CI gate:
exits non-zero on anything not already explained by that workspace's `ignore` /
`ignoreDependencies` / `ignoreIssues` / `ignoreUnresolved`).

## Known precision notes (see `sample-walk.md` for the full trace)

- `scripts/apply-domain-v2.py` (root) has no cross-reference found anywhere in the repo; it
  is outside Knip's JS/TS analysis scope entirely (Python), so Knip provides no independent
  signal either way. Kept as `used`/`cli-script` but flagged for an owner to confirm at U030
  time rather than treated as a clean pass.
- A handful of engineer/workflow `cli-script` and `operator-route` entries have imprecise
  `usage.manual` / `discoverySource` text (e.g. a route wired directly into `server.ts` whose
  `discoverySource` says "via routes/index.ts"); their `path`/`disposition` are correct, only
  the descriptive metadata is loose. Not a reachability error.
