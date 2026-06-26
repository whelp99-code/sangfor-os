# AIOS v1 Integration Baseline

Date: 2026-06-26

## Position

AIOS v1 is a preserved source asset and runtime baseline for `sangfor-os`.
It should not be deleted or bypassed until its useful features are absorbed,
wrapped, or bridged with evidence.

## Current Evidence in `sangfor-os`

| Area | Evidence | Status |
| --- | --- | --- |
| Proxy adapter | `packages/proxy-core/src/aios-v1-adapter.ts` | Present |
| Proxy package exports | `packages/proxy-core/src/index.ts`, package dist output | Present |
| Launch script | `scripts/launch-aios-v1-stack.sh` | Present |
| Integration stack | `scripts/start-integration-stack.mjs` references `AIOS_V1_PATH` and default `AIOS v1` path | Present |
| Mock upstream | `scripts/mock-upstreams.mjs` includes AIOS v1 mock on port 3101 | Present |
| Mail verification | `scripts/verify-aios-features-with-mail.mjs` | Present |
| AIOS v3 bridge | `apps/web/src/lib/aios-v3-bridge.ts`, `apps/web/src/app/api/aios-v3/*` | Present |

## Required Parity Checks

| Check | Evidence Needed | Status |
| --- | --- | --- |
| AIOS v1 upstream health | local health/readiness response or mock upstream evidence | Pending |
| Mail import/readiness route | non-sending smoke or test evidence | Pending |
| Customer and project candidate route | API or unit/integration test evidence | Pending |
| Approval gate behavior | blocked high-risk action evidence | Pending |
| v3 bridge health | route/test evidence | Pending |
| Fallback behavior | mock upstream evidence | Pending |

## Safety Rules

- Do not send real mail during parity checks.
- Do not mutate operational DBs during parity checks.
- Do not deploy or create release tags.
- Use mocks or local fixtures first.

## Next Step

Create `docs/reports/legacy-feature-parity-checklist.md` after the first
read-only bridge smoke and map each AIOS v1 feature to one of:

- Already absorbed
- Bridged and verified
- Wrapped but not verified
- Missing from `sangfor-os`
- Intentionally retired with approval
