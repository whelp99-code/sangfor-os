# 캘리브레이션 브랜치 출하 전 게이트 — fix/classifier-calibration

- 워크트리: `/Users/jmpark/Playground/sangfor-os/.worktrees/wp-calib`
- 브랜치: `fix/classifier-calibration`
- 커밋: `56cd3c9`, `42a0a31`, `763cd95`, `9c0d132` (base: `ddd529d`)
- 코드 수정 없음, git 조작 없음 (build/test 명령만 실행)

## 결과 요약 (지시된 순서 그대로 실행)

| # | 게이트 | Exit Code | 판정 | 증거 로그 |
|---|--------|-----------|------|-----------|
| ① | `pnpm lint` | 2 | **FAIL** | `/tmp/calib-lint.log` |
| ② | `pnpm typecheck` (1차 시도) | 2 | FAIL (재시도 대상) | `/tmp/calib-typecheck-1.log` |
| ② | `pnpm typecheck` (rm -rf apps/web/.next 후 재시도) | 2 | **FAIL** | `/tmp/calib-typecheck-2.log` |
| ③ | `pnpm test` | 1 | **FAIL** | `/tmp/calib-test.log` |
| ④ | `pnpm build` | 0 | **PASS** | `/tmp/calib-build.log` |
| ⑤ | `CI_INTEGRATION=1 pnpm --filter @sangfor/business test` | 0 | **PASS** | `/tmp/calib-business-test.log` |

**VERIFY 기준(5개 전부 exit 0) 미충족: ①②③이 지시된 순서 그대로는 실패.**

단, 아래 근본 원인 분석 결과 ①②③의 실패는 **캘리브레이션 브랜치의 코드 결함이 아니라 워크트리 환경 문제**로 확인됨 (자세한 내용은 "근본 원인" 절 참조). 이 브랜치가 실제로 건드리는 `packages/business`의 테스트(게이트 ⑤, 그리고 진단 재실행에서의 게이트 ③ 일부)는 전부 통과.

## 게이트별 상세

### ① pnpm lint — FAIL (exit 2)
`packages/infra`의 3개 파일에서 타입 에러 발생:
```
../../packages/infra/src/engineer-console.ts(10,24): error TS2307: Cannot find module '@sangfor/config' or its corresponding type declarations.
../../packages/infra/src/integration.ts(13,24): error TS2307: Cannot find module '@sangfor/config' or its corresponding type declarations.
../../packages/infra/src/mcp-client.ts(13,24): error TS2307: Cannot find module '@sangfor/config' or its corresponding type declarations.
Failed
/Users/jmpark/Playground/sangfor-os/.worktrees/wp-calib/apps/web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @sangfor/web@0.1.0 lint: `eslint . && tsc -p tsconfig.json --noEmit`
Exit status 2
 ELIFECYCLE  Command failed with exit code 2.
EXIT_CODE=2
```
apps/web ESLint 자체는 47개 warning, 0 error (React Compiler/react-hooks 관련 기존 경고들, 이 브랜치와 무관). **`calib-run.local.ts`는 lint 출력에 전혀 등장하지 않음** (`grep -n "calib-run" /tmp/calib-lint.log` → 매치 없음) — untracked 운영 스크립트는 lint 스코프 밖.

### ② pnpm typecheck — FAIL (exit 2, 재시도 후에도 동일)
1차: `packages/auth/src/token-manager.ts(7,27): error TS2307: Cannot find module '@sangfor/config'` 에서 중단.
`rm -rf apps/web/.next` 후 재시도: 동일 원인, 이번엔 `packages/infra`가 먼저 실패 (`engineer-console.ts`, `integration.ts`, `mcp-client.ts` 3곳 + `packages/auth/src/token-manager.ts`). `.next` 캐시와 무관한 실패로 확인 — flaky 이슈 아님.

### ③ pnpm test — FAIL (exit 1)
`packages/infra`의 vitest 3개 스위트가 동일 모듈을 vite 런타임에서 resolve 못해 실패:
```
packages/infra test: Error: Failed to resolve entry for package "@sangfor/config". The package may have incorrect main/module/exports specified in its package.json.
packages/infra test:  FAIL  src/engineer-console.test.ts [ src/engineer-console.test.ts ]
packages/infra test:  FAIL  src/integration.test.ts [ src/integration.test.ts ]
packages/infra test:  FAIL  src/mcp-client.test.ts [ src/mcp-client.test.ts ]
```
**중요**: `pnpm -r test`는 실패 시 이후 패키지 실행을 중단하므로, **`packages/business` 테스트는 이 실행에서 아예 시작되지 않음** (`grep -n "business" /tmp/calib-test.log` → 매치 없음). 즉 이 브랜치가 실제로 바꾼 코드는 이 gate에서 검증되지 못했음 — 아래 진단 재실행에서 별도 확인.

### ④ pnpm build — PASS (exit 0)
`pnpm -r build`는 의존성 위상 순서로 전체 패키지를 빌드하므로 그 과정에서 `packages/config`가 먼저 빌드되어 `dist/`가 생성됨. `apps/web` Next.js 프로덕션 빌드까지 전체 성공.

### ⑤ CI_INTEGRATION=1 pnpm --filter @sangfor/business test — PASS (exit 0)
```
 Test Files  71 passed (71)
      Tests  582 passed | 1 todo (583)
   Duration  3.22s
EXIT_CODE=0
```
`@sangfor/business`는 `@sangfor/config`에 의존하지 않아(package.json 확인: `@sangfor/shared`, `@sangfor/db`, `@sangfor/mail-intelligence`, `@octokit/rest`, `zod`만 의존) 위 이슈의 영향을 받지 않음. mail-candidates 관련 캘리브레이션 테스트 포함 전부 통과.

## 근본 원인 분석

1. **브랜치 diff 확인** (`git diff --stat main...HEAD`): 이 브랜치는 `packages/business/**`와 `.agents/results/**` 문서/스크린샷만 변경. `packages/infra`, `packages/config`는 전혀 건드리지 않음 → ①②③의 실패는 이 브랜치의 코드 결함이 아님.
2. **원인**: 신규 git worktree에는 gitignore된 빌드 산출물(`packages/config/dist/`)이 없음. `packages/config`의 `package.json`은 `"types": "./dist/index.d.ts"`를 가리키므로, dist가 없으면 이를 참조하는 `packages/infra`, `packages/auth`가 타입/런타임 resolve에 실패.
3. **CI가 실제로 하는 순서**와 대조 (`.github/workflows/ci.yml` 44-52행, 91-95행): lint job은 `pnpm install` → `pnpm db:generate` → `pnpm --filter "./packages/**" build` → `pnpm lint` → `pnpm typecheck` 순으로 실행 (주석: "apps/web lint ... needs the generated Prisma client and the workspace library packages' built dist/types"). test job도 `pnpm --filter "./packages/**" build` 후에 `pnpm test:coverage` 실행. 즉 **CI는 lint/typecheck/test 전에 라이브러리 패키지 사전 빌드를 항상 선행**하는데, 이번 지시된 절차(①lint→②typecheck→③test→④build)는 이 선행 빌드 단계 없이 실행됨.
4. **진단 재실행으로 확인**: 게이트 ④(`pnpm build`)가 `packages/config/dist`를 생성한 뒤, 동일 명령을 재실행하면:
   - `pnpm lint` → exit 0 (47 warning, 0 error) — `/tmp/calib-lint-diag2.log`
   - `pnpm typecheck` → exit 0, `packages/business typecheck: Done` 포함 — `/tmp/calib-typecheck-diag3.log`
   - `pnpm test` → exit 0, `packages/business test: Test Files 66 passed | 5 skipped (71), Tests 554 passed | 28 skipped | 1 todo (583)` 포함 — `/tmp/calib-test-diag2.log`

   즉 CI와 동일한 선행 빌드 조건이 갖춰지면 5개 게이트 전부 exit 0.

## calib-run.local.ts (untracked)
`packages/business/calib-run.local.ts`는 두 lint 실행 로그 어디에도 나타나지 않음 (untracked라 eslint 스코프 밖). 커밋 대상 아님, 무시함.

## 부수 발견 (코드 수정 아님)
`apps/web/next-env.d.ts`가 build/typecheck 실행 중 Next.js에 의해 자동 재생성되어 1줄 변경됨 (`.next/dev/types/routes.d.ts` → `.next/types/routes.d.ts`). 이 파일 상단에 "NOTE: This file should not be edited"라고 명시된 자동 생성 파일이며, 내가 수동으로 편집하거나 git 조작을 한 것이 아님. git 조작 금지 지침에 따라 되돌리지 않고 현재 상태 그대로 둠 — 필요시 `git checkout -- apps/web/next-env.d.ts`로 원복 가능.

## 결론 / BLOCKED
지시된 정확한 순서(사전 빌드 없이 lint 먼저)로는 5개 중 3개가 FAIL이라 VERIFY 기준(전부 exit 0)을 충족하지 못함 — 문자 그대로는 **BLOCKED**.
다만 근본 원인은 이 브랜치의 결함이 아니라 워크트리에 사전 빌드 산출물이 없었던 환경 문제이며, CI가 실제로 사용하는 순서(라이브러리 패키지 선빌드 → lint/typecheck/test)로 실행하면 5개 게이트 전부 exit 0으로 통과함을 진단 재실행으로 확인함. 이 브랜치가 실제로 수정한 `packages/business`의 테스트는 원래 지시된 순서에서도(게이트 ⑤) 문제 없이 통과했음.
