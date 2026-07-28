# Worktree preservation audit — 2026-07-28

## Scope and baseline

- Repository: `/Users/jmpark/Playground/sangfor-os`
- Branch: `fix/owner-confirmed-entity-map`
- Starting HEAD: `d3ebfd8ecca0c2db8c7d152137e176d05ad11e30`
- Starting status: 86 collapsed untracked status entries, representing 689 files; 0 tracked modifications.
- Safety constraints observed: no push, branch switch/delete, checkout, restore, clean, reset, or force operation.

## Original classification

Counts below are actual files. The `status entries` column uses Git's default collapsed directory display and sums to the reported 86 entries.

| Category | Files | Status entries | Representative paths | Disposition |
|---|---:|---:|---|---|
| Intended feature/documentation change | 3 | 3 | `docs/plans/2026-07-13-design-i18n-pass.md`, `docs/plans/2026-07-13-security-authz-hardening.md`, `docs/plans/2026-07-14-real-usage-week-and-followups.md` | Preserved in WIP commit `666d7081` |
| Tests, fixtures, and QA evidence | 352 | 3 | `.agents/results/design-pass/` (27), `.agents/results/ux-loop/` (319), `EV/independent-review/` (6) | Left uncommitted because provenance and long-term retention intent are unclear |
| Build/generated/operational artifacts | 259 | 58 | `.agents/results/learning/` (206), `.agents/results/kpi/` (37), `.agents/results/backups/` plus `backups/` (13), `.local-uxtest/` (2), `services/sangfor-engineer-mcp/outputs/` (1) | Obvious local/sensitive subsets ignored; seven ambiguous report/export artifacts remain visible |
| Residual debug/session material | 74 | 21 | `.agents/coop/` (49), `brain/.../scratch/` (6), 19 empty root files such as `Artifact.id`, `blocked`, and `running` | Scratch directory ignored; collaboration notes and empty files left uncommitted |
| Unknown | 1 | 1 | `.agents/results/2026-07-07-prod-mainfork-restart.md` | Left uncommitted pending owner decision |
| **Total** | **689** | **86** |  |  |

## Ignore hardening

Commit `1e262f7b` adds only clear local/sensitive patterns:

- `backups/` and `.agents/results/backups/`
- `*.log` and `.local-uxtest/`
- `brain/`
- `.agents/results/learning/`

These rules hide 258 files from future Git status without deleting them. QA screenshots/reports, collaboration notes, KPI text/image summaries, the generated MCP presentation, and unexplained empty files were deliberately not ignored because their retention intent is ambiguous.

## WIP commits

1. `1e262f7b83f34d40fe0ad3ea28665102d9060462` — `chore(wip): ignore local generated artifacts`
2. `666d70810b00f41855955afda9e76a1694682a0c` — `docs(wip): preserve July operating plans`

This audit report is preserved in a separate commit; its exact hash is reported to the coordinator after commit creation.

## Verification

- `pnpm test` — exit 0.
- 149 test files passed, 15 skipped; 1,010 tests passed, 70 skipped.
- Package totals: db 9, shared 16, auth 7, infra 25, business 697, agent 18, api 63, web 175 passed.
- Expected negative-path stderr and deprecation warnings appeared, but there were no failing tests.
- `git diff --cached --check` passed before each commit.

## Remaining uncommitted files

After the ignore hardening and the two WIP commits, 428 files remain visible and uncommitted:

### Tests, fixtures, and QA evidence — 352 files

- `.agents/results/design-pass/` — 27 files
- `.agents/results/ux-loop/` — 319 files
- `EV/independent-review/` — 6 files

### Generated/operational artifacts with ambiguous retention — 7 files

- `.agents/results/kpi/deal-risk-widget-20260712.png`
- `.agents/results/kpi/engineer-rag-panel-20260712.png`
- `.agents/results/kpi/kpi-20260710.txt`
- `.agents/results/kpi/kpi-20260713.txt`
- `.agents/results/kpi/kpi-20260720.txt`
- `.agents/results/kpi/kpi-20260727.txt`
- `services/sangfor-engineer-mcp/outputs/Sangfor_설정가이드_MCP.pptx`

### Residual debug/session material — 68 files

- `.agents/coop/` — 49 files
- Empty repository-root files — 19: `0`, `Artifact.id`, `ArtifactVersion.id`, `Company`, `LicenseMetric.id`, `ProductEdition.id`, `ProductFamily.id`, `ProductSku.id`, `Quote.id`, `QuoteServiceLineItem.id`, `User.id`, `UserCompanyRole.id`, `blocked`, `cancelled`, `expired`, `ready_for_human_approval@1`, `revoked`, `running`, `stale`

### Unknown — 1 file

- `.agents/results/2026-07-07-prod-mainfork-restart.md`

No remaining file was deleted, staged, or modified.
