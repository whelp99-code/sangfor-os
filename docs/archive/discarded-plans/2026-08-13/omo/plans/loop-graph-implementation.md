# Loop/Graph 개선 구현 계획 (P0–P5)

> 근거: [loop-graph-deep-audit.md](loop-graph-deep-audit.md) (177/177 전수 감사). 본 문서는 실행 계획 — 각 항목은 RED(실패 증거) → GREEN(최소 구현) → 검증 순으로 진행한다.
> 작성 2026-08-11 · 티어 HEAVY(세션 인증 코드·승인 커널·다중 도메인)

## 환경 제약 (정직하게 명시)
- **Docker 없음** → `CI_INTEGRATION=1` 통합 테스트 및 라이브 HTTP 서버 기동 불가. 검증 표면은 **단위 테스트 + typecheck + lint + 주입 시임을 통한 실제 함수 실행(auxiliary surface)**으로 한정한다. 통합 검증은 미실행으로 보고한다.
- Node 20.20.2 (nvm) + pnpm 10.28.1 고정. 패키지 사전 빌드 필요(`pnpm --filter "./packages/**" build`).

## 착수 전 확정된 사실 (디스커버리 결과)
1. `resolveCaller` 6곳은 **동일하지 않다** — md5 3종: (a) workflow-runs/[id]/definitions-activate 3곳 동일, (b) workflow-definitions 1곳(포매팅만 차이), (c) artifacts 2곳은 **반환 타입이 다름**(`{ error: Response }` 래핑). 통합 시 (c) 호출부 정규화 필수.
2. **`@sangfor/business`는 `infra`/`health`를 의존하지 않는다**(deps: shared·auth·db·mail-intelligence). 감사서의 "probe→watchdog 엣지"는 **레이어 역행이라 그대로 구현 불가** → P1 재설계.
3. `packages/health`는 db 의존이 없다(deps: config·infra) → health 안에서는 DB 영속 상태 추적 불가.
4. `/api/agent/workflow/run`(deprecated)에 **살아있는 소비자 존재**: `apps/web/src/lib/agent/use-workflow-run.ts:42` (SSE 스트리밍 UI 훅). 감사서의 "호출자 마이그레이션 완료"는 **오류**. 정식 `/api/workflow-runs`는 SSE 시뮬레이션을 제공하지 않아 단순 교체 불가 → P4 범위 축소.
5. `recordToolFailure`는 commandRunId 결합형이라 임베더 관측에 부적합 → P2는 별도 경량 경로.

---

## P0 — resolveCaller 공유 헬퍼 추출
**대상**: `apps/web/src/app/api/{workflow-runs,workflow-runs/[id],workflow-definitions,workflow-definitions/[id]/activate,artifacts/[artifactId]/versions,artifacts/[artifactId]/release-evaluation}/route.ts`
**신규**: `apps/web/src/app/api/_lib/resolve-caller.ts` — `resolveApprovalKernelCaller(request): Promise<ApprovalKernelCaller | Response>`

1. RED: `resolve-caller.test.ts` 신규 — 토큰 없음→401, JWT 설정 실패→401, 세션 MFA_STALE→403, 정상→scope 파생 caller. 헬퍼 부재로 import 실패(RED).
2. GREEN: 헬퍼 구현(3종 중 정식형 = Response 직접 반환). 각 라우트에서 로컬 정의 삭제 후 import 교체. artifacts 2곳은 `{ error }` 언랩 → `isResponse` 분기로 정규화.
3. 검증: 6개 라우트의 기존 colocated 테스트 green + 신규 헬퍼 테스트 green + typecheck.
**적대적 리스크**: artifacts 호출부가 `resolved.error`를 참조하는 곳을 놓치면 raw 객체가 응답으로 샐 수 있음 → 변경 후 `rg 'resolved.error'` 잔존 0 확인.

## P1 — 통합 프로브 재검증 엣지 (재설계)
감사 원안(watchdog 연결)은 레이어 위반. **대안**: `packages/health`에 상태 전이 추적기를 추가해 measure→judge→**re-verify** 그래프를 닫는다(신규 의존 0).
1. RED: `registry.transitions.test.ts` — 동일 타깃을 unreachable 2회 연속 프로브 후 healthy로 회복시켰을 때 "연속 실패 횟수"와 "회복 검증됨" 신호가 리포트에 없음을 실패로 고정.
2. GREEN: 모듈 내 인메모리 전이 추적(`consecutiveFailures`, `recoveredAt`)을 `UnifiedServiceHealth`에 추가. 주입형 clock 유지, 프로세스 로컬 상태임을 JSDoc에 명시.
3. 검증: health 단위 테스트 green + `/api/unified-health`가 `consecutiveFailures`·`recoveredAt`을 보존하는지 확인.
**한계 명시**: DB 영속 에스컬레이션(WorkTask 생성)은 business↔health 레이어 결정이 필요하므로 **본 계획 범위 밖**(후속 과제로 기록).

## P2 — 임베더 실패 관측 + 재시도
**대상**: `packages/business/src/domain-ai/domain-embedding.ts` (safeEmbed:25-34, recallSemanticFromDb:118)
1. RED: `domain-embedding.test.ts`에 케이스 추가 — 임베더가 1회 실패 후 성공하는 스텁일 때 (a) 재시도로 벡터를 획득해야 하고 (b) 실패 사실이 관측 가능한 카운터/상태로 노출되어야 함. 현재는 즉시 null 강등 → RED.
2. GREEN: `safeEmbed`에 경계 재시도(기본 1회 재시도, 주입형 지연=0 for tests) + 모듈 수준 `getEmbedderHealth()` 카운터(연속 실패/마지막 실패 사유). console.warn 유지(회귀 방지).
3. 검증: business 단위 테스트 green + 기존 recall 테스트 무회귀.

## P3 — u002 스크립트 데이터 주도화 (범위 한정)
**대상**: `scripts/check-u002-containment-surface.mjs`의 freshness 쌍(5756 `assertRunnerFinalizationInputsFresh` / 5775 `assertRunnerOutputPathsFresh`) — 스팟체크로 동형 확인됨.
1. 사전: 기존 4,642줄 테스트가 두 함수를 커버하는지 확인. 미커버면 **characterization 테스트 선행**(현 동작 고정).
2. GREEN: 공통 실행기 `assertForbiddenPathsFresh({ paths, errorCode, exitCode, rootBinding })` 추출 후 두 함수를 얇은 래퍼로. 반환 형태(`checked/created`, `checked/allowed`)는 그대로 보존.
3. 검증: 기존 스크립트 테스트 green + 두 함수 출력 동일성.
**리스크**: 릴리스 게이트 스크립트 — 깨지면 게이트가 막힌다. 테스트 커버 미확인 시 **중단하고 보고**(범위 축소가 정답).

## P4 — deprecated 정리 (범위 축소) + autopilot 거버너
1. **라우트 제거는 보류**: `use-workflow-run.ts`가 SSE로 실사용 중이며 정식 라우트에 대체 SSE 경로가 없음. 제거는 UI 기능 손실 → **사용자 결정 필요 사항으로 보고**하고 코드 변경 없음.
2. **autopilot 거버너 정리(실행)**: `autopilot.ts:89-101` — 이미 `suggest`인 정책을 매 pass 재강등+warn 반복. RED: 이미 강등된 정책에서 두 번째 pass가 `demoted`에 다시 넣지 않아야 함(현재는 넣음). GREEN: 현재 mode 확인 후 skip.
3. 검증: `autopilot.test.ts` green.

## P5 — 소형 엣지 2건
1. **B1 승인 검증거부 관측**: `approval-kernel.ts:362-395` submitApprovalRequest — 실패 시 tx 중단으로 무기록. RED: `readyApprovalRequest` 실패 시 호출자가 실패 사유를 구조화된 오류로 받는지 확인하는 테스트. GREEN: 실패를 `ApprovalKernelError("VALIDATION_REJECTED", ...)`로 명시 변환(tx 밖 이벤트 발행은 outbox 트랜잭션 계약을 깨므로 **하지 않음** — 오류 타입 명시가 최소 정답).
2. **B3 navigateToMenu 재검증**: `services/sangfor-mcp-workflow/scripts/lib/device-menu-capture.ts:56-74` — 404 해시 교정 후 재검증 없음. RED: 교정 후에도 404인 경우를 잡지 못함을 고정. GREEN: 교정 후 1회 `pageHas404` 재확인.

---

## 실행 순서와 게이트
P0 → P1 → P2 → P3 → P4 → P5. 각 항목 완료 시 해당 패키지 단위 테스트를 돌리고, 전체 마무리에 `pnpm --filter @sangfor/web test` + `--filter @sangfor/business test` + typecheck + lint 1회. 커밋은 항목별 원자 커밋.
