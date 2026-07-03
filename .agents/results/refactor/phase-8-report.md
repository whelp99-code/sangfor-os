# Phase 8 Report — 툴링/워크스페이스/CI 표준화 (2026-07-03)

## 태스크별 커밋 및 실측 결과

| Task | 커밋 | 요약 |
|---|---|---|
| 8-1 | `3890c6c` | workflow-service 툴체인 정렬: `typescript` `^5.7.0`→`^5.9.3`, `vitest` `^3.0.0`→`^3.2.4`, `packageManager` `pnpm@10.12.4`→`pnpm@10.28.1` (8개 package.json). `engines.node >=22`는 무변경(Global Constraints). 서비스 테스트 58 pass / 6 skip. `tsc -b`는 `apps/operator-console`에서 7건 에러로 실패하나, TS 5.7.3으로도 동일 재현 확인 — **버전 정렬과 무관한 기존 결함**(task-8-1-report.md). |
| 8-2 | `8cfaef0` | tsconfig emit 모순 2건 해소: `packages/mail-intelligence/tsconfig.json`에서 죽은 `outDir` 삭제, `packages/ui/tsconfig.json`에 `declaration: true` 추가(d.ts 방출 시작). 전역 `pnpm typecheck` 0 errors. |
| 8-3 | `e8a5b48` | `ci.yml`의 `lint`/`typecheck` job을 단일 `static-checks` job으로 통합. `build` job의 `needs`를 `[lint, typecheck, test]`→`[static-checks, test]`로 갱신. CI 1회당 `packages/**` 빌드 3→2회, `pnpm install` 5→4회로 감소. |
| 8-4 | `3434d36` | `cd.yml`의 가짜 배포 echo 3단계(`Deploy to Production`/`Notify Deployment`/`Notify Failure`) 제거, workflow 이름을 `CD`→`Production Build Check`로 정직화. job 이름 `deploy`→`build-check`. |
| 8-5 | `41b11f1` | `services-ci.yml` 신규 생성 — services 2곳 최초 CI 커버리지(path-filtered: `services/**`). `engineer-mcp` job은 typecheck(no-op)/build/test 전부 blocking(로컬 확인: build PASS, test 39 pass/2 skip). `mcp-workflow` job은 typecheck(no-op)/test는 blocking(58 pass/6 skip)이나 `build` 단계만 `continue-on-error: true`로 처리 — Task 8-1에서 확인된 기존 operator-console 결함 때문(처음부터 red CI를 만들지 않기 위함). |
| 8-6 | (본 커밋) | `packages/db/.env.example` 신규(DATABASE_URL 플레이스홀더만, 실값 미포함), `docs/DEV_REFERENCE.md` 환경 변수 절 갱신, 본 리포트 작성. |

## 관리자(레포 설정) 작업 — 이미 완료됨

- **브랜치 보호 필수 체크 갱신**: Task 8-3 완료 후 `required_status_checks.contexts`가 `["lint","typecheck","build","secrets-scan","test"]`에서 `lint`/`typecheck`를 `static-checks`로 교체한 `["build","secrets-scan","test","static-checks"]`로 갱신 완료(레포 설정, 사용자 작업). `gh api repos/whelp99-code/sangfor-os/branches/main/protection --jq '.required_status_checks.contexts'`로 확인.
- **PR #85 머지**: Phases 2-7(dedup, layering, decomposition, business restructure, API unification, DB expansion) 통합 PR이 2026-07-03 08:31 UTC `main`에 머지됨.

## 전/후 메트릭

| 항목 | 전 | 후 |
|---|---|---|
| CI 1회당 packages/** 빌드 횟수 | 3 (lint/typecheck/test) | 2 (static-checks/test) |
| CI 1회당 pnpm install 횟수 | 5 | 4 |
| services CI 커버리지 | 0 서비스 | 2 서비스 (path-filtered: engineer-mcp 전부 blocking, mcp-workflow build만 continue-on-error) |
| tsconfig emit 모순 | 2건 (mail-intelligence inert outDir, ui declaration 부재) | 0건 |
| TS 버전 스큐 | workflow-service `^5.7.0` (워크스페이스는 `^5.9.3`) | 전 리포지토리 `^5.9.3` |
| vitest 스큐 | workflow-service `^3.0.0` (워크스페이스 `^3.2.4`, engineer-mcp `^4.1.8`) | workflow-service `^3.2.4`로 정렬 (engineer-mcp만 `4.x` 유지 — 마스터 플랜 승인 예외, §11-I 참조) |
| packageManager 스큐 | `10.12.4`(workflow-service) / `10.28.1`(워크스페이스) | `10.28.1` 통일 |
| cd.yml | 가짜 배포 echo 3단계 | 정직한 Production Build Check (workflow_dispatch 전용) |
| 브랜치 보호 required checks | `lint`,`typecheck`,`build`,`secrets-scan`,`test` | `static-checks`,`build`,`secrets-scan`,`test` (갱신 완료) |
| packages/db env 문서화 | 없음 | `.env.example` 존재 (DATABASE_URL 플레이스홀더) |

## §11-I 결정 기록 (services 워크스페이스 편입)

마스터 플랜 권장은 "편입"이었으나, 실측 결과 다음 차단 요인으로 이번 사이클은 대안 트랙(services 전용 CI, Task 8-5)을 채택했다:

1. `@sangfor/shared` 패키지명이 루트 `packages/shared`와 `services/sangfor-engineer-mcp/packages/shared`에서 충돌 — 편입 시 pnpm 워크스페이스 이름 충돌 발생.
2. moduleResolution 불일치: 루트 base=`bundler`, services=`NodeNext`.
3. vitest 메이저 갈림(workspace/workflow-service `3.x` vs engineer-mcp `4.x`), `workflow-service`의 `engines.node >=22`(루트는 `20`).

편입하려면: engineer-mcp의 `shared` rename → 두 서비스 워크스페이스 글롭 편입 → 툴체인 통일(moduleResolution·vitest 메이저·node engines) → CI 재편 순으로 필요. 별도 사이클로 이월한다.

## 이월 항목

- `packages/ui`의 `strict: false`(리포지토리 내 유일한 strict-off 패키지) — strict 전환은 코드 수정을 수반하므로 별도 작업으로 이월.
- playwright 버전 스큐 (`@sangfor/chrome` `^1.60` / engineer-mcp `^1.56.1` / workflow-service `^1.61`).
- `services/sangfor-mcp-workflow`의 `apps/operator-console` 기존 TS 결함(누락된 `.js` 확장자, 해석 불가 `./health.routes` 모듈, implicit-`any` 2건) — `services-ci.yml`의 `mcp-workflow` build 단계가 `continue-on-error: true`로 우회 중. 정식 수정은 별도 티켓.
- env 변수 73개(web 29 / api 18 / business 36 합집합) 중 example 파일 미기재분 정밀 감사 — 신규 변수 추가 시 example도 함께 갱신하는 룰만 이번에 문서화(§5 환경 변수).
- §11-I 편입 자체(위 3가지 차단 요인 해소 후 재검토).
