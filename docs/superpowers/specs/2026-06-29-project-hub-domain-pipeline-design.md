# 프로젝트 허브 = 도메인 파이프라인 인스턴스 — 설계 (Design)

- 작성: 2026-06-29
- 상태: 설계 (자율 모드 — 셀프/독립 비판 후 재설계, 그다음 plan)
- 관련 메모: product-philosophy-human-in-loop-learning, domain-axis-workflow, opportunity-to-engagement-feature, mail-to-customer-partner-pipeline

## 1. 목적 / 문제
제품은 **업무자동화 OS**다. 현재 "프로젝트" 개념이 3개로 파편화됨(`Project`/`FinanceProject`/`Engagement`)이고, CFO(재무)와 영업·납품·메일 워크플로우가 한 점으로 모이지 않는다. 또 우리가 나눈 **AI 도메인(마케팅→세일즈→프리세일즈→엔지니어→CFO)**과 프로젝트가 연결돼 있지 않다.

목표: **프로젝트(Engagement) = 도메인 파이프라인의 인스턴스**로 삼아, 한 딜이 5개 도메인 AI를 거쳐 흐르며 각 도메인이 산출물을 만들고, **사람이 어느 지점에서든 개입(수정/재요청/수동생성)하며, 그 개입이 도메인 AI의 학습이 되어 점진적으로 사람을 대신**하게 한다.

## 2. 핵심 철학 (불변 원칙 — product-philosophy 메모 참조)
- 일은 AI가, 그러나 **사람은 항상 모든 노드에 개입 가능**(수정·값입력·프로젝트/고객/파트너 생성·수정). 권한 기반.
- 모든 AI 산출물 = **읽기전용 기록이 아니라 "제안"** → `[수정][재요청][승인]`.
- **학습 루프가 영혼**: 사람 수정 → 캡처 → 도메인 메모리 → 점점 "사용자처럼" → 자율도 상승 → 대체.

## 3. 데이터 모델 연결 (재설계 — 독립 비판 반영)
> **정정**: 초안의 "caseRef = engagementId"는 **틀렸다**. 코드 확인 결과 `DomainDecisionLog.caseRef`는 DomainCase(상류 seed/아티팩트) id이고(`domain-agent-runtime.ts:160`, 스키마 주석), 라이브 15행 중 0개가 engagement와 일치. 따라서 프로젝트↔도메인 결정 연결은 caseRef로 하지 않는다. (Phase 2에서 `DomainDecisionLog`에 실제 `engagementId`를 추가하거나 caseRef 규약을 강제·백필.)

```
Engagement (= 프로젝트, 단일 축)
 ├─ 산출물(기존 관계): meetingNotes, generatedDocuments(제안서), pocProjects, checklistItems
 └─ ★ 재무: Invoice(매출) / Expense(비용) / TaxInvoice(direction=purchase 매입 | sales 매출)
        → 각 테이블에 engagementId? 추가. **허브 손익은 engagementId 축만 집계**.
```

- **스키마 변경 (Phase 1)**: `Invoice.engagementId?`, `Expense.engagementId?`, `TaxInvoice.engagementId?` (nullable, 인덱스). 마이그레이션(shadow-diff).
- **이중부모 회피 (I1)**: 기존 `FinanceProject` 축은 **레거시 CFO 페이지 전용**으로 유지, **프로젝트 허브는 engagementId 축만 사용** → 한 뷰가 한 축만 집계하므로 이중집계 없음. FinanceProject↔Engagement 통합은 별도 결정(범위 밖).
- **TaxInvoice는 direction으로 분리 (I2)**: purchase→매입(원가), sales→매출(수익). P&L 부호가 여기서 갈림.
- **아티팩트→도메인 매핑** = 문서화된 휴리스틱(가능한 한 `DOMAIN_DEFINITIONS.ownedEntities` 근거): proposal→presales, poc→presales, checklist→engineer(=Engagement 자체가 delivery_projects), invoice/expense/taxInvoice→cfo, mail-lead→marketing. **MeetingNote는 다중도메인**(소유 도메인 없음) → "공통" 표기.

## 4. 도메인 자율도 (autonomy) — **Phase 1에서 제외**
> **정정 (I3)**: 자율도는 사람의 실제 검토/수정 기록이 있어야 의미가 있다. 현재 결정로그는 데모 noise(전부 approved, edit 없음) → 어떤 공식이든 **가짜 100%**. Phase 1엔 사람 개입 쓰기 경로가 없으므로 **자율도 배지를 넣지 않는다.** Phase 2에서 사람 결정(`humanEditJson`/outcome)을 실제로 기록하기 시작한 뒤, 사람-신호 있는 행만 대상으로, 표본≥N일 때만 산출한다.

## 5. 화면 (프로젝트 허브 — /projects/[id] 확장)
도메인 레인 코크핏 (CFO 테마 재사용: ink/paper/hairline/inflow/outflow/brass):
- 헤더: 프로젝트명·고객사·현재 도메인·원천 기회. 전역 `[+프로젝트][+고객][+파트너]`.
- **도메인 파이프라인 바**: 마케팅●→세일즈●→프리세일즈◐→엔지니어○→CFO○ (완료/진행/예정 + 컬러게이트 상태).
- **도메인 레인 5개**: 각 레인 = {산출물 목록, 컬러게이트 배지, [수정][재요청][승인], 자율도 배지, recall 메모}. CFO 레인 = 매입/매출/비용 + **딜 손익 스트립**(매출−매입−비용=마진).
- **다음 액션** 패널: 런타임/사람 주도 제안.

## 6. 단계적 구현
| Phase | 내용 | 가치 |
|---|---|---|
| **1 통합 뷰(기초)** | 재무 engagementId 연결 + `project-hub` 집계(business) + `/api/projects/[id]/hub` + 읽기전용 도메인 레인 UI(+CFO 손익) | CFO·워크플로우가 프로젝트로 수렴 |
| **2 사람개입+학습** | 모든 산출물 `[수정][재요청][승인]` → `DomainDecisionLog.humanEditJson`+outcome 기록 → `DomainMemory` 학습 + 자율도 배지 | 학습 루프 작동 |
| **3 런타임 구동** | `domain-agent-runtime`로 단계별 제안 생성·게이트·핸드오프 + 다음액션 | AI가 실제로 일함 |
| **4 자율 위임** | 자율도 임계 시 자동통과 확대 | 점진 대체 |

## 7. Phase 1 상세 (재설계 — "실데이터로 손익이 보이는 수직 슬라이스")
> 비판 C2/C3 반영: 현재 Engagement·Opportunity 0개, 재무에 engagementId 없음 → 단순 UI만 만들면 빈 껍데기. 따라서 Phase 1은 **연결 + 실데이터 seed**까지 포함해 손익이 실제 숫자로 렌더되게 한다. 자율도/결정로그는 제외.

- **스키마**: `Invoice/Expense/TaxInvoice.engagementId?`(인덱스) + 마이그레이션(shadow-diff). (메모 정정: 이 repo는 §3.G로 정식 마이그레이션 전환됨 — `db push` 아님. 단 `migrate dev` 파괴적 리셋 회피 위해 shadow-DB `migrate diff`로 SQL 생성·수기 배치.)
- **순수함수 (단위테스트)**:
  - `domain-pnl.ts` `computePnl({invoices, expenses, taxInvoices})` → `{ 매출, 매입, 비용, 마진, marginPct }` (TaxInvoice는 direction으로 분리).
  - `artifact-domain-map.ts` `domainOfArtifact(kind)` + 레인 상태 도출(산출물 존재 기반). MeetingNote=공통.
- **business `project-hub.ts`**: `getProjectHub(engagementId)` → `{ engagement, lanes: DomainLane[], pnl }`. `DomainLane = { domain, status, artifacts[] }` (자율도 없음). DB read + 위 순수함수 조합.
- **API**: `/api/projects/[id]/hub` (web) — engagement 상세 + lanes + pnl.
- **UI**: `/projects/[id]`를 도메인 레인 코크핏(읽기전용)으로 확장. 기존 4카드(제안서/POC/미팅/체크리스트)를 도메인 레인으로 재배치 + **CFO 레인에 손익 스트립**(engagementId 축). 자율도 배지·[수정/재요청/승인] 액션은 Phase 2.
- **실데이터 seed (Phase 1 포함)**: 실제 고객 1곳으로 Opportunity 생성 → `convertOpportunityToProject`로 Engagement 1건 생성(웹/비즈니스 플로우 사용) → 실제 넥시아스 **매입 세금계산서 일부를 그 engagementId에 배정**(매입 원가). 결과: 그 프로젝트 화면에 실제 매입 숫자가 뜸. (배정 UI는 Phase 2; Phase 1 seed는 스크립트/플로우로.)

## 8. 테스트/검증 전략
- 순수함수(아티팩트→도메인, 상태 도출, autonomy, pnl 계산) = vitest 단위테스트.
- 집계/서비스 = 통합테스트(`CI_INTEGRATION=1`, 공유DB 직렬, 범위 한정 정리 — 기존 패턴).
- 라이브 검증: dev 서버(3101) + 실제 Engagement로 `/projects/[id]` 렌더 확인(메모: prod build pre-broken → dev).

## 9. 범위 밖(YAGNI, 후순위)
- Phase 2-4(사람개입 쓰기·런타임·자율위임)는 본 spec에 방향만; 구현은 후속.
- Project(테넌트)/FinanceProject 통합 리팩터링은 하지 않음(engagementId 브리지로 충분; 대규모 리팩터 회피).
- 멀티회사/권한 RBAC 세분화는 후순위.

## 10. 리스크 / 미해결
- FinanceProject ↔ Engagement 이중 프로젝트 개념 공존(혼란 가능) → Phase 1은 engagementId 브리지만, 통합은 별도 결정.
- DomainDecisionLog가 지금까지 비어있음 → Phase 1 레인 상태는 주로 "산출물 존재 여부"로 도출, 결정로그는 Phase 2부터 채움.
- 자율도 공식은 MVP 휴리스틱 → 실데이터로 보정 필요.
