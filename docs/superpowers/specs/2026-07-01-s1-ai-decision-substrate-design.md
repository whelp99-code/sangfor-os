# S1 — AI 의사결정·자율도 토대 (Decision Substrate) 설계

**날짜**: 2026-07-01 · **상태**: 설계 확정(사용자 위임 승인, 복귀 시 검토) · **범위**: 남은 로드맵 ④⑤ 중 첫 하위 프로젝트

## 0. 배경 & 목적

개선 루프(22라운드)로 결함은 소진됐고, 남은 것은 로드맵 항목이다:
- **④ AI 자동화 가동** — 이미 구현된 파이프라인에 자동 트리거 + 영속화 + 폴백
- **⑤ 데이터 수집** — 결정·활동·전이 로그로 자율도 학습

이 스펙은 그 **토대(S1)** 다: **AI/워커의 모든 의사결정을 통일 기록**해 (1) 신뢰도 캘리브레이션, (2) 자율도 승격/강등을 **데이터로** 결정할 수 있게 한다. 외부 자원(LLM키·실데이터) 없이 오늘 착수 가능하며, 이후 ④의 자동 트리거·리스크 게이팅이 이 위에 붙는다.

**왜 이것부터인가 (복리효과):** 자율도(무엇을 AI에게 맡길지)는 승인/반려/수정 이력이 쌓여야 정할 수 있고, 그 이력은 지금부터 구조화 적재하지 않으면 소급 불가다. 자동화를 먼저 켜면 캘리브레이션 데이터가 없어 자율도를 영원히 못 올린다(계기판 없는 자율주행).

### 외부 설계 문서(“메일 인입 5대 워커”)와의 관계
사용자가 검토 요청한 `deepseek_markdown_20260701` 문서는 트랙 B(자동화)의 대안 청사진이다. 4개 렌즈(아키텍처·기존코드정합·보안·제품)의 결론: 그 문서의 **최대 결함(캘리브레이션·결정-결과 로그·자율도 로드맵 부재)이 바로 이 S1**이다. 즉 그 자동화 비전은 S1 없이는 위험한 껍데기다. 문서에서 취할 값진 부분(트리거 사전, 리스크 티어 개념, RFP/계약 파싱 2개 신규 갭)은 요구사항으로 흡수하되, 외부 SaaS 재구축(Salesforce/NetSuite/Pinecone 등 — 우리는 자체 보유)은 채택하지 않는다.

## 1. 핵심 설계 결정 (확정)

| # | 결정 | 근거 |
|---|------|------|
| D1 | **`DomainDecisionLog`을 확장**(신규 테이블 아님) | 이미 `DomainDecisionLog`(schema:1448) + `computeAutonomy()`(project-decision.ts:75)라는 자율도 엔진 존재. 신규 테이블+병렬 write는 4번째 진실원을 만드는 자기모순. 확장이 SSOT 취지를 더 잘 달성. *(원 메뉴에 이 옵션이 없어 사용자는 "신규테이블 A"를 골랐음 — 적대검증으로 상향 수정, 복귀 시 거부권)* |
| D2 | **actor 기준축 = 도메인 레인** (`sales·presales·cfo·marketing·engineer`) + 횡단 게이트(`commercial_approval·deal_registration`) 별도 actor. 컬러 렌즈는 `reviewLens` 부가차원 | 자율도의 자연 단위 = "업무기능 × 액션타입". 문서 5워커·GTM 파이프라인과 정합 |
| D3 | **리스크 티어 = fail-closed 안전 화이트리스트** (정적 정책 레지스트리). T0 자동(내부·되돌림가능·무발신)/T1 승인후발신(외부·저위험)/T2 항상 사람(계약·환불·LOST·임원경보·할인≥임계). **미등록 액션 → T2**. 신뢰도는 티어 **안에서** 개입강도만. **T2→자동 승격 불가(타입/런타임 하드가드)** | 현행 `isUnsafeAction`는 "위험 allowlist"라 미등록=자동(안전구멍). fail-closed로 반전 필요 |
| D4 | **계측 = 중앙 `recordDecision()`, 트랜잭션 밖 best-effort** (try/catch 삼킴) | opportunity-center.ts:107 기존 규약("best-effort audit outside transaction"). 계측 실패가 결정을 막으면 비파괴 위반 |
| D5 | **`gateDecision()`는 1차에서 순수 라벨링 전용**(판정 안 함) | modes.ts:181 + quote-engine 후처리와의 삼중 판정 충돌 회피 |
| D6 | **riskTier·policyVersion 스냅샷 저장** (조회시 유도 아님) | 정책 변경 시 과거 결정 캘리브레이션이 소급 왜곡되지 않도록 |

## 2. 스키마 (DomainDecisionLog 확장)

```prisma
enum DecisionActor { sales presales cfo marketing engineer commercial_approval deal_registration }
enum RiskTier { T0 T1 T2 }
// actionType: 코드 레지스트리(const union)로 통제. DB 컬럼은 String 유지하되 recordDecision()에서
// 레지스트리 미등록 값이면 거부/경고. (Prisma enum은 새 액션마다 마이그레이션 필요 → 유연성 위해 레지스트리 채택.
// 자유문자열 금지 — 현재 decisionType은 10+ 변형·casing 혼재로 집계 붕괴)

model DomainDecisionLog {
  // ── 기존 유지 ──
  id, projectId, domain, caseRef(폴리모픽), inputJson, outputJson, colorGateJson(=reviewLens),
  humanEditJson(=editDiff), outcome(approved|rejected|corrected), createdAt, updatedAt
  // ── 신규(전부 nullable, 순수 추가) ──
  actor               DecisionActor?
  actionType          String?    // 레지스트리 상수로 통제
  riskTier            RiskTier?  // 결정 시점 스냅샷
  policyVersion       String?    // riskTier 근거 정책 버전
  predictedConfidence Float?     // 지점마다 유무 다름 → nullable 필수
  modelVersion        String?
  cost                Decimal?   @db.Decimal(10,4)
  rollbackOf          String?    // 되돌림/소급취소 신호(승격 게이트 핵심)
  resolvedAt          DateTime?
  resolvedBy          String?
  @@index([actor, actionType, createdAt])  // 캘리브레이션 groupBy
  @@index([domain, caseRef])                // 폴리모픽 역참조
}
```
**PII/보존**: `outputJson`/`humanEditJson`에 고객 견적·메일본문 유입 → 보존 TTL 또는 원문 대신 diff요약 저장(후속 슬라이스에서 정책 확정).

## 3. 구성요소 (단위·인터페이스)

- **`recordDecision(input)`** (business/src/ai-decision.ts, 신규) — `DomainDecisionLog`에 append. 트랜잭션 밖, best-effort. `logStateTransition`(audit.ts:8) 판박이.
- **`gateDecision(actor, actionType, confidence?) → {tier, requiresHuman, autoAllowed}`** (순수함수) — 정적 정책 레지스트리 조회. fail-closed. 1차엔 라벨링만(흐름 분기 없음).
- **리스크 티어 레지스트리** — `{actionType → tier}` 안전 화이트리스트 상수 + `policyVersion`.
- **read-model** (`ai-decision-analytics.ts`) — `domain-dashboard.ts:150` groupBy 패턴 복제. (actor×actionType) 승인/반려/수정률 + confidence 버킷. `computeAutonomy` 재사용.

## 4. 1차 슬라이스 (YAGNI, 이번 배포)

**넣을 것 (고가치·저마찰):**
1. 스키마 확장 + 마이그레이션(순수 추가, nullable) + 티어 레지스트리 상수.
2. `recordDecision()` + `gateDecision()`(라벨링 전용) + TDD.
3. **계측 배선 2곳**(트랜잭션 밖 best-effort):
   - 단계전이 — opportunity-center.ts:193, :227 (기존 `logStateTransition` 옆, 최안전 선례)
   - 메일 revalidation — mail-candidates.ts:2068 (실제 LLM `revalidation.confidence`·4-way decision 있어 데이터 품질 최상)
4. read-model 집계 함수(승인/반려/수정률) + 최소 API.

**뺄 것 (후속 슬라이스):**
- `commercial-approval` 계측(순수 동기함수 → async화 연쇄파괴; quote persist 지점에서 별도 슬라이스)
- mail 승인/반려 계측(이미 `PolicyDecisionLog`에 outcome 존재, 한계효용 낮음)
- 자율도 승격/ECE 산출(표본 축적 전 무의미), rollback 소급 라벨링·지연결과 backfill 잡
- `gateDecision`의 실제 게이팅(트랙 B), 자동 트리거, RFP/계약 파싱

## 5. 자율도 정책 (설계 원칙 — 후속 슬라이스에서 강제)

- **기본 티어 fail-closed**: 미등록 actionType → T2. `isUnsafeAction` allowlist 반전.
- **경계 방어**: 임계 ±버퍼존 강제 T2 + 히스테리시스(승격/강등 임계 비대칭).
- **승격 = 사람 승인(2인), 강등 = 자동·즉시.** T2는 승격 함수 입력에서 타입레벨 배제.
- **라벨링 = 잠정→확정 2단계**: 사람 approve는 `provisional`(러버스탬프 편향 방지), 지연 실결과(딜 win/lose·환불·클레임) backfill로 확정 라벨. confidence 하드코딩 상수(현행 90/85) 금지, 실측 캘리브레이션.
- **승격 게이트**: `precision≥p0 AND rollback율≤r0 AND ECE≤e0 AND (전체 n≥N0 AND 오답클래스 n≥k0)`. `MIN_AUTONOMY_SAMPLE=3`은 데모용, 프로덕션 게이트와 분리.

## 6. 성공 기준

- 스키마·helper·gate·read-model TDD 통과, CI green.
- 2개 지점에서 실 결정이 `DomainDecisionLog`에 actor/actionType/riskTier/confidence와 함께 append됨(비파괴 — 기존 흐름 불변).
- read-model이 (actor×actionType) 승인/반려/수정률을 반환.
- **후속(트랙 B) 자동화가 이 로그를 데이터원으로 자율도를 결정할 수 있는 구조 확보.**

## 7. 리스크 & 완화

| 리스크 | 완화 |
|---|---|
| 계측이 결정 흐름을 깨뜨림 | 트랜잭션 밖 best-effort try/catch (D4) |
| actionType 난립으로 집계 붕괴 | 레지스트리 상수 통제 |
| 정책 변경 소급 왜곡 | riskTier·policyVersion 스냅샷 |
| 공유 main·타 세션 충돌 | 격리 worktree, 순수추가 마이그레이션, CI 게이트 auto-merge |
| 스코프 폭주 | 1차 슬라이스 2지점·라벨링만, 나머지 후속 |
