# Loop/Graph 개선 계획 — jm-loop-miner 분석 기반

> **후속 전수 감사**: [loop-graph-deep-audit.md](loop-graph-deep-audit.md) (177/177 소스 대조, 2026-08-11) — 우선순위가 §4에서 갱신됨. 본 문서의 P0-P4는 심층 감사로 대체.

- 작성: 2026-08-11 · 분석 도구: jm-loop-miner v0.3.0 (read-only 정적 분석)
- 스캔 대상: `/home/jm/orca/projects/sangfor-os` (커밋 72fe1f1, main)
- 분석 산출물: `/home/jm/orca/projects/sangfor-os-loop-miner-output-20260811/` (analysis.json · report.md · report.html · contracts 280건, source integrity PASS)
- 스캔 규모: 파일 1,761 · 함수 5,215 · 호출 엣지 16,316 · 파스 에러 0 (제외: node_modules, .local-prod, local-recovery, artifacts, EV 등)

## 1. 실행 요약

| 판정 | 건수 | 의미 |
|---|---:|---|
| STRONG_LOOP | 0 | 자동 수렴 루프로 즉시 승격 가능한 후보 없음 |
| LOOP_CANDIDATE | 0 | 〃 (보강하면 가능한 후보도 0) |
| REVIEW_REQUIRED | 177 | 루프 구조는 있으나 **검증자 독립성/피드백 엣지 보강 필요** |
| DO_NOT_LOOP | 291 | 단순 iteration (261건이 syntax_loop) — 조치 불필요 |
| DENIED | 273 | 반복 시 비가역/중복 부작용 위험 (248건 repeated_side_effect) |

**핵심 판정: `VALID_NO_RECOMMENDATION`** — 이 코드베이스에는 "즉시 자동화 가능한 수렴 루프"가 없다. 이는 결함이 아니라 **일관된 설계 철학의 반영**이다: 승인 게이트(approval-gate), human-in-loop AI 검토, CAS(revision) 기반 상태 전이가 자동 루프화를 의도적으로 차단한다. 마이너의 결과는 "루프를 만들라"가 아니라 **어디에 피드백 엣지가 끊겨 있고, 어디가 그래프화(명시적 상태 전이 + 재검증 엣지)로 개선되는지**를 알려준다.

## 2. 구조적 발견 (evidence 기반)

### F1. 지배적 패턴: "교정 후 재검증 엣지 누락" — 145건
177개 REVIEW_REQUIRED 중 145건이 동일한 missing edge를 공유한다: **`explicit verified re-entry after the correction action`** — 실패를 감지하고 교정(catch/fallback/degrade)하지만, 교정 결과를 다시 검증하는 엣지가 없다. 대표 사례:

- `packages/infra/src/integration.ts:134-194` — `probeIntegrationTarget`: latencyMs/상태를 **측정만** 하고 반환. 소비자는 `packages/health/src/registry.ts`와 `apps/api/src/index.ts`(메트릭 노출)뿐 — degraded/unreachable 판정이 어떤 교정·알림 엣지로도 이어지지 않는 **open-loop 모니터링**. (candidate-edb54ec1ff99, loopability 84/100, risk 6/100 — 전체 1위)
- `packages/business/src/domain-ai/domain-embedding.ts:25-34` — `safeEmbed`: 임베더 실패 시 `console.warn` 후 null 반환(구조적 태그 폴백). 실패가 콘솔 밖 어디에도 축적되지 않아 임베더 장애가 지속돼도 관측 시스템에 잡히지 않음.
- `packages/business/src/orchestration/workflow-runtime.ts:283-308` — `transitionRunWithClient`: CAS 전이 실패 시 에러 throw로 끝. (단, `startWorkflowRun:257-276`은 이미 모범적 수렴 루프 — bounded retry + unique-violation 승자 해소 + backoff. **이 패턴이 사내 표준이 되어야 한다.**)

### F2. 진짜 SCC 순환 4건 (call_graph_cycle)
- `domain-embedding.ts:25` ↔ `domain-agent-runtime.ts:151-242` — `safeEmbed → runDomainStage → embed` 순환. 행동과 검증이 한 순환 위에 있어 자기오염 가능(마이너 지적). recall 품질 평가(recallTags)가 자신이 만든 임베딩에 의존.
- `orchestration/autonomy-policy.ts:34-90` — `checkAutopilotEnabled → resolveAutonomyMode → loadPolicy` (한 변은 테스트 파일 — 실위험 낮음).
- `scripts/check-runtime-contract.mjs:361-436`, `scripts/check-entrypoint-inventory.mjs:804-829` — 검증 스크립트 내부 순환 (DENIED, 스크립트라 실행 영향 없음).

### F3. 복붙 중복 — 루프화(데이터 주도화) 대상
- **`resolveCaller` 동일 구현 6곳 복붙**: `apps/web/src/app/api/{workflow-runs,workflow-runs/[id],workflow-definitions,workflow-definitions/[id]/activate,artifacts/[artifactId]/versions,artifacts/[artifactId]/release-evaluation}/route.ts` — 세션 JWT → ApprovalKernelCaller 변환 ~8줄이 6번 반복. 마이너는 이 중 4곳을 missing_feedback_edge로 개별 검출.
- **`scripts/check-u002-containment-surface.mjs` 6,356줄 + 테스트 4,642줄**: 단일 파일에서 마이너 후보 24건 검출(전체 hotspot 1위). 반복 검사 로직이 함수 나열로 커져 있음 — 검사 항목의 테이블/데이터 주도 루프화가 곧 유지보수성.
- 161개 route.ts에 `assertApiAccess` 190회 — 셸 패턴 자체는 명시성을 위한 의도적 반복으로 판단(개선 대상 아님, 아래 §5 참고).

### F4. DENIED가 가리키는 실제 위험 2건
273건 DENIED의 다수(248건)는 로컬 `array.push`를 부작용으로 집계한 보수적 판정이지만, 다음은 실질:
- `packages/business/src/orchestration/autopilot.ts:106-273` `runAutopilotPass` / `:52-104` `checkReversalsAndDemote` — **자동 승인/강등을 반복 실행하는 외부 부작용 루프** (duplicate_action + infinite_loop 플래그). 스케줄러가 이 pass를 재실행할 때 중복 실행 방어(멱등 키/단일 비행)를 코드 레벨에서 재확인할 것.
- `apps/web/src/app/api/agent/workflow/run/route.ts:19-92` — successor_race_candidate(단일 소유자 클레임 없는 successor 생성). 이 라우트는 `@deprecated`이지만 `apps/web/src/lib/agent/use-workflow-run.ts`가 SSE 스트림을 계속 소비한다. **SSE 기능을 갖춘 successor로 소비자를 먼저 이관하기 전에는 제거할 수 없다.**

## 3. 개선 계획 (우선순위 순)

### P0 — resolveCaller 공유 헬퍼 추출 (효과 즉시, 위험 최소)
6곳 복붙을 API 오류 응답 의존성을 소유한 `apps/web/src/app/api/_lib/resolve-caller.ts` 단일 함수로 추출.
- 검증: 6개 라우트의 기존 colocated route.test.ts 그대로 green + `pnpm --filter @sangfor/web test`.
- 효과: 세션 검증 정책 변경 시 6곳 동기 수정 → 1곳. MFA 정책 드리프트 위험 제거.

### P1 — integration probe에 교정 엣지 연결 (그래프화 대표 과제)
`@sangfor/business`에서 health/watchdog를 호출하면 의존성 DAG를 역행하므로 watchdog 연결안은 폐기한다. 대신 `packages/health`의 canonical registry가 프로세스 로컬 `consecutiveFailures`와 recovery probe의 `recoveredAt`을 유지해 measure→judge→re-verify 그래프를 닫고, `/api/unified-health`가 이를 노출한다.
- 검증: 페이크 fetch와 주입 clock 단위 테스트 + unified-health projection 테스트.
- 한계: 프로세스 재시작/다중 인스턴스에 걸친 영속 에스컬레이션은 상위 호출자 소유 후속 과제다.

### P2 — domain-ai 임베딩 실패의 관측 가능화 + 순환 분리
`safeEmbed` 실패를 console.warn에서 기존 관측 경로(`platform/observability.ts` 또는 llm-metering)로 승격해 실패율을 측정 가능한 변수로 만들기. `runDomainStage`가 자기 임베딩으로 recall을 평가하는 순환은 평가 전용 임베더/골든 태그셋을 분리해 검증자 독립성 확보(마이너 hidden-verifier 권고와 일치).
- 검증: 임베더 다운 시나리오 단위 테스트(embed throw → 메트릭 증가 + 폴백 recall 동작).

### P3 — check-u002-containment-surface.mjs 데이터 주도 분해
6,356줄 스크립트를 검사 항목 테이블(descriptor 배열) + 실행 루프로 재구성, 파일 분할(scripts/lib/u002/*). 기존 4,642줄 테스트가 characterization 안전망.
- 검증: 분해 전후 스크립트 출력 동일성(diff) + 기존 테스트 green. 대규모라 별도 세션 권장.

### P4 — autopilot pass 멱등성 감사 + legacy 라우트 제거 완결
(a) `runAutopilotPass` 중복 실행 시 이중 승격/강등이 불가능함을 증명하는 동시성 테스트 추가(사내 표준: `@unique` + `$transaction` + P2002 catch — DEV_REFERENCE 컨벤션). (b) `@deprecated` `/api/agent/workflow/run` 제거 일정 확정(consumer 검색 → 제거 → 410 고정 테스트).

### 비조치 결정 (명시적으로 하지 않음)
- **자동 수렴 루프 도입 금지 유지**: STRONG_LOOP 0은 승인 게이트 철학의 증거. 마이너 UCR 계약(contracts/ 280건)은 검토용이며 실행 승인이 아님(도구 자체 규칙).
- **route 셸 패턴(assertApiAccess 반복) 래퍼화 안 함**: fail-closed 명시성이 미들웨어 은닉보다 감사에 유리 — apps/web AGENTS.md의 보안 원칙과 일치.
- **improvement-loop.ts는 개선 대상 아님**: 이름과 달리 human-approval CRUD 파이프라인이며 자동 루프가 아닌 것이 올바른 설계.

## 4. 분석의 한계 (정직성)
- 마이너는 로컬 `array.push`도 side effect로 집계(DENIED 248건 중 다수는 양성). DENIED 수치를 위험 총량으로 읽지 말 것.
- 테스트/스크립트 파일도 후보에 포함됨(hotspot 상위에 *.test.mjs 존재). 본 계획은 프로덕션 경로만 P0-P4로 승격.
- 최고 convergence index 0.52 — 어떤 후보도 자동 실행 임계에 도달하지 못함(도구 설계상 실행은 전 판정 금지).

## 5. Evidence
- 스캔 로그: exit 0, 49.2s (2026-08-11), `VALID_NO_RECOMMENDATION`, source integrity PASS
- 산출물: `/home/jm/orca/projects/sangfor-os-loop-miner-output-20260811/{analysis.json,report.md,report.html,contracts.json,worker-views.json,SHA256SUMS}`
- 인용 candidate: candidate-edb54ec1ff99 (integration probe, 84/100) 외 §2 각 항목의 file:line은 본 세션에서 소스 대조 완료
- 스캔 설정: `sangfor-os-loop-miner-output-20260811/scan-config.json` (스냅숏/아티팩트 디렉터리 제외)
