# Coverage baseline — 2026-07-02 (Phase 0 §0-3)

## Tooling gap found and fixed

The root `pnpm test:coverage` script (`pnpm -r test:coverage`) could not run at
all: **no workspace package defines a `test:coverage` script**, and
`@vitest/coverage-v8` was not installed anywhere in the repo (confirms plan
P21 — "커버리지 미추적"). Added `@vitest/coverage-v8@^3.2.4` as a root
devDependency (matches the pinned `vitest@^3.2.4`) so `vitest run --coverage`
is usable; this baseline was produced by running `vitest run --coverage
--coverage.reporter=text-summary` directly in each of the 8 packages/apps that
have a real `"test": "vitest run"` script (the other 11 workspace packages
have no tests — `echo "No tests"`).

Wiring a permanent `test:coverage` script + CI coverage upload is Phase 8's
job (plan §Phase 8 item 3: "`pnpm test:coverage`를 test job에 편입"); this
baseline only needed a one-off run.

## Per-package summary (V8 provider, statements/branches/functions/lines)

| Package | Test files | Tests | Statements | Branches | Functions | Lines |
|---|---|---|---|---|---|---|
| packages/agent | 3 passed | 18 passed | 76.27% (270/354) | 78.57% (66/84) | 94.73% (18/19) | 76.27% (270/354) |
| packages/auth | 2 passed | 7 passed | 29.54% (151/511) | 85.71% (36/42) | 50.00% (12/24) | 29.54% (151/511) |
| packages/business | 59 passed, 9 skipped | 457 passed, 47 skipped, 1 todo | 51.01% (6101/11960) | 72.92% (1306/1791) | 63.09% (318/504) | 51.01% (6101/11960) |
| packages/db | 1 passed | 5 passed | 4.70% (44/935) | 87.50% (14/16) | 85.71% (12/14) | 4.70% (44/935) |
| packages/infra | 4 passed | 25 passed | 58.19% (245/421) | 78.12% (75/96) | 76.92% (30/39) | 58.19% (245/421) |
| packages/shared | 2 passed | 4 passed | 61.23% (188/307) | 83.33% (5/6) | 66.66% (4/6) | 61.23% (188/307) |
| apps/api | 11 passed, 5 skipped | 52 passed, 29 skipped | 24.69% (1022/4139) | 72.13% (132/183) | 30.63% (53/173) | 24.69% (1022/4139) |
| apps/web | 28 passed, 1 skipped | 114 passed, 3 skipped | 3.87% (1139/29416) | 63.51% (423/666) | 54.23% (237/437) | 3.87% (1139/29416) |

Notes on the low outliers:
- **apps/web (3.87%)**: coverage instruments every file under `src/` including
  all page/route components; almost all functional coverage today comes from
  e2e (Playwright), not unit tests — this package's unit-test surface is
  intentionally thin (lib helpers, a handful of route handlers).
- **packages/db (4.70%)**: this package is mostly the generated Prisma client
  + a thin RLS helper; the 5 rls.test.ts cases are its only unit-testable
  surface.
- **apps/api (24.69%)**: several finance-service test files are fully skipped
  in plain `pnpm test` (gated behind `CI_INTEGRATION` / live DB), so this
  number understates what the CI_INTEGRATION run would cover.

## Baseline totals (this run, plain `pnpm test`, no `CI_INTEGRATION`)

Aggregate across the 8 tested packages: **457 + 18 + 7 + 5 + 25 + 4 + 52 + 114
= 682 tests passed**, 84 skipped, 1 todo, 0 failed.

Phase 0 added 47 new test cases to `packages/business` (5 in
`opportunity-center.test.ts`, 4 in `poc-center.test.ts`, 13 in
`proposal-generator.test.ts`, 25 snapshot assertions in
`mail-candidates.golden.test.ts`), all running hermetically (no DB, no
network) via the DI seams described in the Phase 0 commits.

## How to reproduce

```bash
pnpm add -D -w @vitest/coverage-v8@^3.2.4   # already committed
for pkg in packages/agent packages/auth packages/business packages/db \
           packages/infra packages/shared apps/api apps/web; do
  (cd "$pkg" && npx vitest run --coverage --coverage.reporter=text-summary)
done
```

## Regression gate for future phases

Later phases (1–8) should re-run the loop above and confirm each package's
statement-coverage percentage does **not decrease** versus the numbers in the
table, per plan §12 ("테스트 ... 커버리지 기준선 대비 비감소").
