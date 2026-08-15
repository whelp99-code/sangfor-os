# Loop/Graph Deep Audit — 177건 전수 소스 대조 (2026-08-11)

> 상위 문서: [loop-graph-improvements.md](loop-graph-improvements.md) (표본 기반 1차 계획). 본 문서는 그 후속 — jm-loop-miner REVIEW_REQUIRED **177건 전건**을 소스 대조로 재판정하고, 그래프화 시 장점과 추후 기능개선·추가·고도화 편의성을 평가한다.
> 방법: 4개 병렬 검증 레인(web 64 · scripts 35 · business/pkgs 39 · services 24) + 직접 판정(테스트 파일 15, DENIED 실위험 3) + 레인 판정 스팟체크 5건 직접 재검증(5/5 일치).

## 1. 최종 판정 분포 (177/177)

| 판정 | 건수 | 의미 |
|---|---:|---|
| REAL-LOOP | 4 | 실존/실익 있는 수렴 루프 — 엔지니어링 가치 확정 |
| REAL-GRAPH-GAP | 4 (실사이트 3) | 교정 후 재검증 엣지가 실제로 끊김 — 닫아야 함 |
| DEPRECATED | 2 | @deprecated 레거시 경로 — 정답은 제거 |
| DESIGNED-ONESHOT | 9 | CAS/승인 거버넌스 일회 결정 — 루프화가 오히려 위반 |
| TEST-ARTIFACT | 18 | 테스트/픽스처 파일 — 대상 아님 |
| NOISE | 140 | 마이너 오탐 (인증 게이트 패턴, 파생데이터 계산, 누산 push) |

**핵심 발견**: 1차 표본 조사 때 "의심"이던 대부분이 오탐으로 확정됐다(79%). 마이너는 (a) `assertApiAccess → 검증 → 커널 1회 호출` 라우트 셸을 피드백 루프로 오인하고, (b) 존재하지 않는 변수명(quality_gap_score 등)을 발명하며, (c) 라우트 계층의 "재검증 누락" 주장 다수는 **커널에 이미 존재**한다(예: ownership-transfer.ts:142-155의 fresh 재스캔 + `OWNERSHIP_PREVIEW_STALE` 409 — 스팟체크로 실증). 아키텍처는 마이너 수치가 시사하는 것보다 건강하다.

## 2. 확정된 "부분" — 루프화/그래프화 대상과 각각의 장점·확장성

### A. REAL-LOOP 4건
| # | 위치 | 현재 상태 | 개선 | 장점 | 기능추가·고도화 편의성 |
|---|---|---|---|---|---|
| A1 | `packages/infra/src/integration.ts:134-194` probeIntegrationTarget | latencyMs/status 측정만; 유일 소비자 `health/registry.ts:280`은 표시용 매핑(remediation은 정적 텍스트) | `packages/health` registry에서 연속 실패와 recovery probe를 프로세스 로컬로 추적하고 unified-health에 노출 | MCP 스택 장애 지속·회복 관측 | **새 integration target 추가 시 자동 커버** — registry 열거에 따라 동일 전이 계약 적용. 영속 에스컬레이션은 상위 호출자 과제 |
| A2 | `packages/business/src/domain-ai/domain-embedding.ts:25-34` safeEmbed | 임베더 실패를 console.warn만 남기고 null 강등; `recallSemanticFromDb:118`이 단일 초크포인트 | 초크포인트에 retry/backoff + degraded-embedder 상태 노출(observability) | 임베더 장애 가시화, recall 품질 저하의 원인 추적 가능 | 초크포인트 1곳 수정으로 runtime+proposal 경로 동시 커버; 임베딩 백엔드 교체·추가 시 상태 계약 재사용 |
| A3 | `services/.../sangfor-chrome/src/index.ts:455-540` loginToConsole | 이미 올바른 수렴 루프(경계 재시도 + URL 독립 검증 — 직독 확인) | retry-with-verification 공용 헬퍼로 표준화 | 실장비 로그인 안정성 유지 | **새 장비 워크플로 추가 시 헬퍼 재사용** — CAPTCHA/OCR류 반복 패턴의 표준 뼈대 |
| A4 | `services/.../scripts/open-kb-and-capture.ts:27-64` KB 토큰 폴 | deadline 경계 폴 + 자식 스크립트 재진입 — 실존 루프 | 현상 유지(경미) | — | — |

### B. REAL-GRAPH-GAP 3사이트
| # | 위치 | 끊긴 엣지 | 개선 | 장점/확장성 |
|---|---|---|---|---|
| B1 | `packages/business/src/governance/approval-kernel.ts:362-395` submitApprovalRequest | 성공만 outbox 이벤트; 실패는 tx 중단으로 무기록(스팟체크 확인) | tx 밖에서 validation-rejected 이벤트 발행 | 승인 파이프라인 실패 관측 — 이후 승인 유형 추가 시 공통 패턴 |
| B2 | `packages/db/scripts/check-domain-integrity.ts:87-165` | ~40개 무결성 검사→exit code만; 수리 경로 없음 | 실패 델타→수리 SQL 제안/재검사 엣지 | CI 자가치유; 새 무결성 규칙 추가 시 수리 규칙도 같은 테이블에 |
| B3 | `services/.../device-menu-capture.ts:56-74` navigateToMenu | IAG 404 해시 교정 1회 후 재검증 없음 | 교정 후 1회 검증 사이클 추가 | 장비 메뉴 캡처 신뢰도; 신규 제품(EPP/CC/IAG 외) 추가 시 동일 패턴 |

### C. DENIED 측 직접 판정 (제품 관련 3건)
- `autopilot.ts:52-104` checkReversalsAndDemote — **실존하는 설계된 부정 피드백 거버너**(AI 승인 3연속 인간 뒤집기→suggest 강등). updateMany 멱등이라 마이너의 위험 경고는 과장이나, 강등 후에도 매 pass 재강등+warn 반복(소음). 개선: 현재 mode 확인 후 skip + observability 이벤트화. **확장성: decisionType 하드코딩을 테이블화하면 새 자동화 도메인에 거버너 재사용.**
- `autopilot.ts:106-273` runAutopilotPass — mode=auto여도 auto-approve 코드가 없음(review draft만 영속, `autoApproved` 증가 코드 부재). 권한 수준 오탐. 잔여: 타임스탬프 churn.
- `command-center.ts:183-206` buildTimeline — 순수함수, 오탐.

### D. 중복 제거형 그래프화 (scripts 레인 구조 분석)
- `check-u002-containment-surface.mjs`(6,356줄): 근사중복 8–10개 확정 — held-attempt 패밀리 6개 함수(1518-1809, 동일 뼈대: 이름검증→linux/darwin 분기→postcondition), freshness 쌍(5756 vs 5775 — 스팟체크로 동형 확인, 차이는 목록·에러코드·추가검사 1개), runFocusedSuites 3중 블록(5029-5105), env-guard 쌍(~85줄 복붙: prepare-ux-fixtures.ts:148 vs seed-real-use-mail.mjs:34).
- 테이블 주도 재구성 시: **신규 containment check 추가 = 3터치(함수+호출+아티팩트 처리)→1행**. 단 정직한 한계: 파일의 15–20%만 테이블화 가능(디스크립터·프로브·HTTP 연습 경로는 본질적으로 커스텀).

## 3. 그래프화 종합 평가 — 장점과 고도화 편의성

**장점 (전수 조사로 확정된 것만)**
1. 관측가능성: 현재 실패 신호 3곳(임베더, 승인 검증 거부, 무결성 검사)이 console/exit code에 갇혀 있음 → 이벤트/상태로 승격 시 운영 대시보드·개선 루프(improvement-loop)의 입력이 됨.
2. 재검증: probe→registry 전이 추적으로 MCP 스택 전체의 measure→judge→re-verify 그래프를 닫는다. business→health/watchdog 연결은 의존성 DAG 역행이므로 구현하지 않는다.
3. 정책 단일화: resolveCaller 6곳(1차 계획 P0)·env-guard 쌍 등 복붙 제거 시 보안 정책 변경이 1곳 수정으로 전파.
4. **아키텍처 검증**: 141건 NOISE + 9건 DESIGNED-ONESHOT의 의미 — 거버넌스 코어(CAS·승인·멱등키)는 루프화가 필요 없을 만큼 이미 올바르게 일회성으로 설계됨. 그래프화는 이 코어를 건드리지 않고 그 주변 관측·교정 엣지만 보강한다.

**추후 기능개선·추가·고도화 시 편의성 (before → after)**
| 시나리오 | 현재 | 그래프화 후 |
|---|---|---|
| 새 integration target 추가 | 프로브는 되나 장애 대응 수동 | 레지스트리 등록만으로 감시+교정 자동 |
| 새 장비 워크플로(신규 제품) | 로그인/재시도 로직 복붙 | retry-with-verification 헬퍼 재사용 |
| 새 워크플로/아티팩트 라우트 | resolveCaller 복붙(7번째) | 공유 헬퍼 import — MFA 정책 자동 적용 |
| 새 containment 게이트 | 함수 작성+호출 삽입+아티팩트 배선 | 체크 테이블 1행 |
| 새 자동화 도메인(autopilot) | 거버너가 autopilot_approve 전용 | decisionType 테이블화로 강등 거버너 재사용 |
| 새 무결성 규칙 | 검사 추가만(수리는 수동) | 검사+수리 규칙을 같은 행에 등록 |

## 4. 갱신된 우선순위 (1차 계획 대체)
P0 resolveCaller 공유화(유지) → P1 registry 전이 추적(A1 재설계) → **P2' 임베더 관측+초크포인트 재시도(A2, 승격)** → P3 u002 테이블화(유지, freshness 쌍으로 한정) → P4 live SSE 소비자가 있는 deprecated workflow-run은 유지하고 autopilot 거버너만 정리 → P5 B1·B3 소형 엣지.

## 5. 판정 부록 — 177건 전건 (id → 판정)
근거 상세: 각 레인 보고서(세션 기록) — web 64행 테이블, scripts 35행 테이블+구조분석, bizpkg 판정별 열거, services 파일별 매핑. 스팟체크 5건(loginToConsole, registry:280, submitApprovalRequest, freshness 쌍, OWNERSHIP_PREVIEW_STALE) 모두 레인 판정과 일치.

| id | 판정 | 레인 | 위치 |
|---|---|---|---|
| 03d767b7 | REAL-LOOP | bizpkg | packages/business/src/domain-ai/domain-embedding.ts:25-34 |
| edb54ec1 | REAL-LOOP | bizpkg | packages/infra/src/integration.ts:34-194 |
| 4324294a | REAL-LOOP | services | services/sangfor-engineer-mcp/scripts/open-kb-and-capture.ts:27-64 |
| 6bce4f8f | REAL-LOOP | services | services/sangfor-engineer-mcp/packages/sangfor-chrome/src/index.ts:455-540 |
| 8f514677 | REAL-GRAPH-GAP | bizpkg | packages/business/src/governance/approval-kernel.ts:362-395 |
| bcf39375 | REAL-GRAPH-GAP | bizpkg | packages/db/scripts/check-domain-integrity.ts:87-165 |
| 61cef567 | REAL-GRAPH-GAP | services | services/sangfor-mcp-workflow/scripts/lib/device-menu-capture.ts:56-74 |
| b8e73340 | REAL-GRAPH-GAP | services | services/sangfor-mcp-workflow/scripts/lib/device-menu-capture.ts:56-74 |
| 772b9069 | DEPRECATED | web | apps/web/src/app/api/approvals/route.ts:173-215 |
| c5f12c7b | DEPRECATED | web | apps/web/src/app/api/agent/workflow/run/route.ts:19-92 |
| 1b608952 | DESIGNED-ONESHOT | bizpkg | packages/business/src/governance/role-change.ts:237-286 |
| 1e0f3eb5 | DESIGNED-ONESHOT | bizpkg | packages/business/src/orchestration/workflow-runtime.ts:283-308 |
| 5b8ab56c | DESIGNED-ONESHOT | bizpkg | packages/business/src/orchestration/workflow-runtime.ts:315-333 |
| 66bb461b | DESIGNED-ONESHOT | bizpkg | packages/business/src/orchestration/workflow-runtime.ts:205-254 |
| 786f94ec | DESIGNED-ONESHOT | bizpkg | packages/business/src/orchestration/workflow-definitions.ts:51-106 |
| 7e45e6fc | DESIGNED-ONESHOT | bizpkg | packages/business/src/crm/customer-partner.ts:660-717 |
| df3807f7 | DESIGNED-ONESHOT | bizpkg | packages/business/src/governance/approval-kernel.ts:532-711 |
| ec7f7b1e | DESIGNED-ONESHOT | bizpkg | packages/business/src/governance/role-change.ts:128-222 |
| ec910780 | DESIGNED-ONESHOT | bizpkg | packages/business/src/orchestration/workflow-runtime.ts:257-276 |
| 0b816f0b | TEST-ARTIFACT | scripts | scripts/run-final-acceptance.mjs:37-48 |
| 48185ba1 | TEST-ARTIFACT | scripts | scripts/qa/verify-ux-evidence.mjs:44-80 |
| 887946ec | TEST-ARTIFACT | scripts | scripts/run-final-acceptance.mjs:36-48 |
| 03201c92 | TEST-ARTIFACT | test-files | scripts/check-u002-containment-surface.test.mjs:1469-1490 |
| 0542c36a | TEST-ARTIFACT | test-files | packages/business/src/orchestration/autonomy-policy.test.ts:202-203 |
| 163438ea | TEST-ARTIFACT | test-files | services/sangfor-mcp-workflow/tests/helpers/lm-studio-fixture.ts:24-136 |
| 17580280 | TEST-ARTIFACT | test-files | apps/api/src/services/finance/hometax-securemail/__fixtures__/synthetic.ts:32-43 |
| 1b8a4e28 | TEST-ARTIFACT | test-files | scripts/check-u002-containment-surface.test.mjs:1855-1933 |
| 22e9c6f1 | TEST-ARTIFACT | test-files | scripts/check-u002-containment-surface.test.mjs:2841-2850 |
| 2aeacad1 | TEST-ARTIFACT | test-files | scripts/check-u002-containment-surface.test.mjs:75-88 |
| 36f8b4fb | TEST-ARTIFACT | test-files | scripts/check-u002-containment-surface.test.mjs:1297-1445 |
| 3c738c65 | TEST-ARTIFACT | test-files | scripts/check-entrypoint-inventory.test.mjs:45-53 |
| 84a79d86 | TEST-ARTIFACT | test-files | apps/api/src/services/finance/hometax-securemail/__fixtures__/synthetic.ts:32-43 |
| c0d149a8 | TEST-ARTIFACT | test-files | scripts/qa/run-real-use-100.test.mjs:25-36 |
| c33b88c1 | TEST-ARTIFACT | test-files | scripts/check-requirement-registry.test.mjs:58-64 |
| e0e9716c | TEST-ARTIFACT | test-files | scripts/check-u002-containment-surface.test.mjs:2837-2854 |
| f575d51d | TEST-ARTIFACT | test-files | packages/business/src/crm/customer-partner-authority.test.ts:143-213 |
| feb1eb46 | TEST-ARTIFACT | test-files | scripts/run-test-alias.test.mjs:35-42 |
| 24e2b70e | NOISE | bizpkg | packages/business/src/mail/classify-rules.ts:660-799 |
| 2ae203de | NOISE | bizpkg | packages/business/src/skills/skill-router.ts:8-52 |
| 3f24452a | NOISE | bizpkg | packages/business/src/crm/customer-partner.ts:183-197 |
| 5ab8285e | NOISE | bizpkg | packages/db/scripts/check-scope-inventory.ts:54-94 |
| 61cb84ec | NOISE | bizpkg | packages/business/src/crm/customer-partner.ts:136-181 |
| 6513109d | NOISE | bizpkg | packages/business/src/crm/opportunity-center.ts:1088-1121 |
| 6838acab | NOISE | bizpkg | packages/db/scripts/run-db-contract.ts:4736-4810 |
| 6ff8ade1 | NOISE | bizpkg | packages/auth/src/session-jwt.ts:295-343 |
| 73532156 | NOISE | bizpkg | packages/business/src/crm/opportunity-center.ts:710-807 |
| 8129a9ac | NOISE | bizpkg | packages/business/src/crm/customer-partner.ts:466-513 |
| 8afb0bc0 | NOISE | bizpkg | packages/db/src/scope-closure.ts:509-533 |
| 96e23797 | NOISE | bizpkg | packages/business/src/crm/opportunity-center.ts:604-658 |
| 97fd55f8 | NOISE | bizpkg | packages/business/src/crm/opportunity-center.ts:1036-1086 |
| 9b740cfb | NOISE | bizpkg | packages/db/scripts/run-db-contract.ts:1436-1538 |
| 9cc28e50 | NOISE | bizpkg | packages/db/scripts/run-db-contract.ts:731-781 |
| a4f976bf | NOISE | bizpkg | packages/config/src/profiles.ts:315-325 |
| ac569ea0 | NOISE | bizpkg | packages/business/scripts/domain-pipeline-demo.ts:39-98 |
| bae6a0f1 | NOISE | bizpkg | packages/business/src/governance/artifact-service.ts:78-153 |
| bd1fbe25 | NOISE | bizpkg | packages/business/src/crm/customer-partner.ts:601-658 |
| c352c1d7 | NOISE | bizpkg | packages/business/src/domain-ai/domain-agent-runtime.ts:151-242 |
| c3fcfc2a | NOISE | bizpkg | packages/business/src/crm/opportunity-center.ts:895-939 |
| d085397e | NOISE | bizpkg | packages/business/src/crm/customer-partner.ts:433-458 |
| eeba433e | NOISE | bizpkg | apps/api/scripts/build-production.mjs:93-113 |
| f559924e | NOISE | bizpkg | packages/infra/src/integration.ts:34-194 |
| fa76ca7c | NOISE | bizpkg | packages/business/src/crm/opportunity-center.ts:809-876 |
| fbc8a5c8 | NOISE | bizpkg | packages/db/src/tenant-restore/import.ts:28-58 |
| 0b81ab43 | NOISE | scripts | scripts/qa/prepare-ux-fixtures.ts:478-517 |
| 179c8f0a | NOISE | scripts | scripts/check-u002-containment-surface.mjs:3061-3167 |
| 1e13aeb2 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:5695-5754 |
| 1e2bd858 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:1546-1583 |
| 1eff7555 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:1740-1752 |
| 2a36b0c4 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:3007-3054 |
| 325b72e8 | NOISE | scripts | scripts/check-entrypoint-inventory.mjs:667-672 |
| 33172ba9 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:1514-1516 |
| 33bf7801 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:2077-2092 |
| 42e8a76f | NOISE | scripts | scripts/run-s9a-contract.mjs:89-116 |
| 443b5158 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:838-862 |
| 5689bdfe | NOISE | scripts | scripts/lib/isolated-postgres.mjs:83-147 |
| 56fd5e84 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:2963-3005 |
| 591e3207 | NOISE | scripts | scripts/restore-drill.mjs:295-366 |
| 78a73b62 | NOISE | scripts | scripts/check-release-state-receipts.mjs:111-288 |
| 7c104882 | NOISE | scripts | scripts/qa/prepare-ux-fixtures.ts:148-224 |
| 91314379 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:5775-5795 |
| 9284f3f7 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:1899-2035 |
| 952fba7e | NOISE | scripts | scripts/check-entrypoint-inventory.mjs:804-829 |
| 9effc3a5 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:5029-5105 |
| a18bed5b | NOISE | scripts | scripts/verify-operational-entrypoints.mjs:76-94 |
| a3014c78 | NOISE | scripts | scripts/qa/seed-real-use-mail.mjs:34-121 |
| a45148cf | NOISE | scripts | scripts/check-u002-containment-surface.mjs:1847-1876 |
| aa5c1915 | NOISE | scripts | scripts/lib/strict-command-result.mjs:51-180 |
| adb98b06 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:1754-1771 |
| b13bae4c | NOISE | scripts | scripts/check-u002-containment-surface.mjs:4763-4806 |
| bcb28f78 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:1906-1910 |
| dbab1c42 | NOISE | scripts | scripts/run-playwright-acceptance.mjs:83-198 |
| dda3404d | NOISE | scripts | scripts/verify-u006-health-surface.mjs:85-96 |
| ee529864 | NOISE | scripts | scripts/check-u002-containment-surface.mjs:5756-5773 |
| f05d74cc | NOISE | scripts | scripts/check-u002-containment-surface.mjs:1518-1540 |
| fec1a9c3 | NOISE | scripts | scripts/sign-external-approval.mjs:112-160 |
| 08ce31a0 | NOISE | services | services/sangfor-engineer-mcp/scripts/debug-kb-home.ts:12-30 |
| 1ecdb191 | NOISE | services | services/sangfor-engineer-mcp/scripts/resolve-kb-token.ts:13-53 |
| 23ae5ed2 | NOISE | services | services/sangfor-mcp-workflow/scripts/run-cc-device-learn.ts:43-87 |
| 37db9d8d | NOISE | services | services/sangfor-engineer-mcp/scripts/learn-kb-full-site.ts:86-106 |
| 3e927bf5 | NOISE | services | services/sangfor-engineer-mcp/scripts/check-embedding-providers.ts:17-48 |
| 3f081797 | NOISE | services | services/sangfor-engineer-mcp/apps/operator-console/src/ui.ts:5-334 |
| 478bed25 | NOISE | services | services/sangfor-mcp-workflow/packages/shared/src/mutation-policy.ts:153-206 |
| 69166ec9 | NOISE | services | services/sangfor-engineer-mcp/packages/sangfor-rag/src/index.ts:246-288 |
| 6f04e0e1 | NOISE | services | services/sangfor-engineer-mcp/scripts/extract-chrome-one-tokens.ts:76-123 |
| 8e47c192 | NOISE | services | services/sangfor-engineer-mcp/packages/sangfor-rag/src/litellm-provider.ts:54-65 |
| 8ee12cfe | NOISE | services | services/sangfor-engineer-mcp/scripts/crawl-kb-with-storage.ts:24-100 |
| 9092f7ed | NOISE | services | services/sangfor-mcp-workflow/scripts/run-device-learn.ts:78-125 |
| 9c02eb94 | NOISE | services | services/sangfor-engineer-mcp/packages/sangfor-rag/src/embedding-provider.ts:30-59 |
| a2f86395 | NOISE | services | services/sangfor-mcp-workflow/scripts/run-hci-backup-setup.ts:68-247 |
| c7982a8c | NOISE | services | services/sangfor-engineer-mcp/apps/operator-console/src/api.ts:115-140 |
| cc290041 | NOISE | services | services/sangfor-engineer-mcp/scripts/learn-kb-full-site.ts:213-273 |
| e2e38a7c | NOISE | services | services/sangfor-engineer-mcp/scripts/capture-one-from-cdp.ts:23-91 |
| e5815eec | NOISE | services | services/sangfor-engineer-mcp/packages/sangfor-collector/src/learn-pipeline.ts:56-163 |
| e601044f | NOISE | services | services/sangfor-engineer-mcp/scripts/learn-kb-full-site.ts:213-273 |
| faac75d9 | NOISE | services | services/sangfor-engineer-mcp/packages/sangfor-approval/src/release-client.ts:6-20 |
| 01b1df56 | NOISE | web | apps/web/src/app/api/workflow-runs/route.ts:32-47 |
| 11aa6385 | NOISE | web | apps/web/src/app/api/catalog/rules/[id]/route.ts:16-45 |
| 11b67b35 | NOISE | web | apps/web/src/app/api/operator/drills/route.ts:9-34 |
| 1286eecd | NOISE | web | apps/web/src/app/api/engagements/route.ts:8-29 |
| 150953d2 | NOISE | web | apps/web/src/app/(portal)/my-work/page.tsx:107-342 |
| 1603c142 | NOISE | web | apps/web/src/app/api/auth/login/route.ts:29-152 |
| 1ba52b96 | NOISE | web | apps/web/src/app/api/dashboard/roi/route.ts:5-20 |
| 1da4f24d | NOISE | web | apps/web/src/app/api/workflow-definitions/[id]/activate/route.ts:16-23 |
| 1eb6353c | NOISE | web | apps/web/src/app/api/mail/calendar-sync/route.ts:32-60 |
| 260fc8dd | NOISE | web | apps/web/src/app/api/engagements/[id]/route.ts:10-35 |
| 265a567c | NOISE | web | apps/web/src/app/api/catalog/products/[id]/route.ts:29-55 |
| 292c3c6e | NOISE | web | apps/web/src/app/(portal)/home/page.tsx:83-427 |
| 2a0b6c86 | NOISE | web | apps/web/src/components/mail/mail-candidates-list.tsx:76-237 |
| 2be5b5af | NOISE | web | apps/web/src/app/(portal)/proposals/page.tsx:19-99 |
| 2f0659d5 | NOISE | web | apps/web/src/app/api/catalog/rules/route.ts:7-36 |
| 319e7718 | NOISE | web | apps/web/src/app/api/partners/route.ts:18-34 |
| 35ff80f3 | NOISE | web | apps/web/src/app/api/security/ownership-transfers/preview/route.ts:5-35 |
| 3fb59722 | NOISE | web | apps/web/src/app/api/autopilot/config/route.ts:62-95 |
| 49bfcc08 | NOISE | web | apps/web/src/app/api/workflow-definitions/route.ts:44-65 |
| 536bc3ce | NOISE | web | apps/web/src/app/api/workflow-runs/[id]/route.ts:16-23 |
| 54af618c | NOISE | web | apps/web/src/app/api/approvals/route.ts:116-166 |
| 55ff3cd6 | NOISE | web | apps/web/src/app/api/security/retention/preview/route.ts:6-37 |
| 56f0168f | NOISE | web | apps/web/src/app/api/opportunities/[id]/registration/route.ts:31-59 |
| 5ec13780 | NOISE | web | apps/web/src/app/api/workflow-definitions/route.ts:18-28 |
| 605ef4fa | NOISE | web | apps/web/src/app/api/contacts/[id]/route.ts:42-55 |
| 74713730 | NOISE | web | apps/web/src/app/(portal)/dashboard/page.tsx:129-160 |
| 767f4ee2 | NOISE | web | apps/web/src/app/api/catalog/products/route.ts:28-49 |
| 76c3ad95 | NOISE | web | apps/web/src/app/api/mail-candidates/[id]/route.ts:55-83 |
| 7b7c095b | NOISE | web | apps/web/src/app/api/mail-candidates/convert/route.ts:50-78 |
| 84185de6 | NOISE | web | apps/web/src/app/api/archive/route.ts:5-28 |
| 879f4608 | NOISE | web | apps/web/src/app/api/security/ownership-transfers/route.ts:6-44 |
| 8862def4 | NOISE | web | apps/web/src/app/api/customers/[id]/route.ts:29-55 |
| 8af2423c | NOISE | web | apps/web/src/app/api/catalog/rules/[id]/publish/route.ts:18-47 |
| 8d3b2eab | NOISE | web | apps/web/src/app/api/operator/scheduler/runs/route.ts:5-20 |
| 8d6f4482 | NOISE | web | apps/web/src/app/api/proposals/[id]/route.ts:57-75 |
| 91d5c909 | NOISE | web | apps/web/src/app/api/partners/[id]/route.ts:45-63 |
| 94188c35 | NOISE | web | apps/web/src/app/(portal)/poc/page.tsx:19-91 |
| 9b157d58 | NOISE | web | apps/web/src/app/api/poc/route.ts:22-49 |
| 9d5ad190 | NOISE | web | apps/web/src/app/api/contacts/[id]/route.ts:27-40 |
| 9f3ed80c | NOISE | web | apps/web/src/app/api/proposals/route.ts:24-52 |
| 9f5c40cb | NOISE | web | apps/web/src/app/api/support/route.ts:5-49 |
| a837f63c | NOISE | web | apps/web/src/app/api/portal/route.ts:37-65 |
| a8ade134 | NOISE | web | apps/web/src/app/(portal)/deals/registrations/page.tsx:38-109 |
| b36c800d | NOISE | web | apps/web/src/app/api/partners/[id]/route.ts:24-43 |
| ba06155d | NOISE | web | apps/web/src/app/api/tasks/[id]/route.ts:68-87 |
| ba06ff15 | NOISE | web | apps/web/src/app/(portal)/projects/page.tsx:13-70 |
| bb1071cd | NOISE | web | apps/web/src/app/api/contacts/route.ts:7-28 |
| c157a084 | NOISE | web | apps/web/src/app/(portal)/contacts/page.tsx:10-45 |
| c15be9b4 | NOISE | web | apps/web/src/app/api/poc/[id]/route.ts:115-133 |
| c16be409 | NOISE | web | apps/web/src/app/api/proposals/[id]/route.ts:33-55 |
| c48f5b58 | NOISE | web | apps/web/src/app/api/opportunities/[id]/route.ts:68-96 |
| c9a34113 | NOISE | web | apps/web/src/app/(portal)/tasks/page.tsx:18-58 |
| ca0beeee | NOISE | web | apps/web/src/app/api/poc/[id]/route.ts:38-113 |
| d19781cc | NOISE | web | apps/web/src/app/api/tasks/route.ts:27-81 |
| d65e83c0 | NOISE | web | apps/web/src/app/api/tasks/[id]/route.ts:28-66 |
| dd6d266e | NOISE | web | apps/web/src/app/api/catalog/imports/route.ts:26-52 |
| eb01d1fa | NOISE | web | apps/web/src/app/api/mail-candidates/[id]/connect/route.ts:31-59 |
| f48a6293 | NOISE | web | apps/web/src/app/api/modules/[moduleKey]/validate/route.ts:16-112 |
| f4991baa | NOISE | web | apps/web/src/app/api/workflow-runs/route.ts:48-57 |
| f77ad390 | NOISE | web | apps/web/src/app/api/customers/route.ts:25-51 |
| fa8de478 | NOISE | web | apps/web/src/app/api/opportunities/route.ts:22-50 |
| fe2fc870 | NOISE | web | apps/web/src/app/api/workflow-runs/route.ts:16-23 |
