# Agentic Company OS for SANGFOR Platinum Partner — 최종 문서 패키지

작성일: 2026-06-24

## 1. 이 패키지의 목적

이 패키지는 범용 Agentic Company OS를 기반으로, 첫 번째 실전 업종 Pack인 **SANGFOR Platinum Partner IT Company Pack**을 설계·구현·운영하기 위한 최종 산출물이다.

핵심 목표는 다음과 같다.

1. SANGFOR 파트너사의 영업, 프리세일즈, 견적, PoC, 구축, 지원, 갱신 업무를 하나의 추적 가능한 운영 시스템으로 통합한다.
2. AI Agent가 산출물을 작성하되, 업무 승인·고객 발송·견적·배포 같은 고위험 의사결정은 사람 승인과 자동 검증을 통과하도록 한다.
3. SANGFOR 전용으로 시작하되, 장기적으로는 Fortinet, Palo Alto, 마케팅회사, 회계회사, 유통회사 등 다른 업종 Pack으로 확장 가능한 구조를 유지한다.
4. 외주 개발팀이 MVP를 실제 구현할 수 있도록 요구사항, DB, API, 워크플로우, 보안, 운영, UX, 테스트 기준을 분리해 제공한다.

## 2. 문서 분류

```text
00_EXECUTIVE/
  CEO와 관리자용 요약 문서

01_SPEC/
  최종 SPEC, 요구사항, 시스템 범위

02_ARCHITECTURE/
  Core 아키텍처, 워크플로우, DB, API

03_BUSINESS/
  SANGFOR 파트너 회사 업무 적합성, 영업/견적/갱신/자산 모델

04_SECURITY/
  보안 아키텍처, Threat Model, 권한, RLS, 감사 로그

05_DATA_AI/
  데이터 거버넌스와 AI 품질 관리

06_UX/
  사용자·운영자·관리자 화면 구조와 가시성 기준

07_OPERATIONS/
  운영자 Runbook, 배포·장애·백업·관측성 가이드

08_IMPLEMENTATION/
  외주 개발 진행 계획, 작업 패키지, 테스트/검수 기준

09_ROI/
  비용, ROI, 성과 지표

10_CODE_SKELETON/
  FastAPI, PostgreSQL, Next.js, seed JSON 뼈대 코드

11_REFERENCES/
  공식 자료와 참고 기준
```

## 3. 전체 진행 순서

### Step 1 — 의사결정 확정

읽을 문서:

- `00_EXECUTIVE/Executive_Brief.md`
- `01_SPEC/SPEC-3-Agentic-Company-OS-SANGFOR-Partner-OS-Final.md`
- `09_ROI/Cost_ROI_Model.md`

확정할 것:

- MVP 범위
- 첫 적용 조직
- 승인권자
- 데이터 보존 정책 책임자
- 외주 개발 범위

### Step 2 — Foundation 구현

읽을 문서:

- `02_ARCHITECTURE/Core_Architecture.md`
- `04_SECURITY/Auth_RBAC_ABAC_RLS.md`
- `02_ARCHITECTURE/Database_ERD_Schema.md`
- `10_CODE_SKELETON/README.md`

구현 대상:

- Tenant / Company / User
- AuthContext
- RBAC + ABAC
- PostgreSQL RLS
- Audit Log
- 기본 대시보드

### Step 3 — SANGFOR Partner Business Workflow 구현

읽을 문서:

- `03_BUSINESS/SANGFOR_Partner_Business_Fit.md`
- `03_BUSINESS/Partner_Workflows.md`
- `03_BUSINESS/Product_SKU_License_Quote_Model.md`
- `02_ARCHITECTURE/Workflow_Approval_Model.md`

구현 대상:

- Customer
- Opportunity
- Deal Qualification
- Discovery Note
- Solution Fit Matrix
- Quote / Margin Approval
- PoC Plan
- Delivery / Support / Renewal Seed

### Step 4 — 데이터·AI 품질 통제 적용

읽을 문서:

- `05_DATA_AI/Data_Governance.md`
- `05_DATA_AI/AI_Quality_Governance.md`
- `04_SECURITY/Security_Threat_Model.md`

구현 대상:

- Data Classification
- Restricted artifact control
- AI Draft / Approved Artifact 분리
- AI Quality Gate
- Prompt / Model Registry
- Evidence Link

### Step 5 — UX와 운영 콘솔 구현

읽을 문서:

- `06_UX/Role_Based_UX_Dashboards.md`
- `07_OPERATIONS/Operator_Runbook.md`
- `07_OPERATIONS/Deployment_Operations_Guide.md`

구현 대상:

- Sales Dashboard
- Presales Dashboard
- Finance Approval Queue
- CEO Executive Dashboard
- Operator Console
- Security Officer Console

### Step 6 — 검수와 운영 전환

읽을 문서:

- `08_IMPLEMENTATION/Acceptance_Criteria_Test_Plan.md`
- `08_IMPLEMENTATION/Implementation_Plan_Milestones.md`
- `07_OPERATIONS/Operator_Runbook.md`

검수 기준:

- 테넌트 격리 테스트 통과
- 승인 우회 테스트 실패 처리
- 감사 로그 hash chain 검증
- AI Draft 고객 발송 차단
- 견적 마진 서버 계산 검증
- 갱신 알림 생성 검증

## 4. MVP 절단 원칙

MVP는 모든 기능을 한 번에 만들지 않는다. 다음 순서로 자른다.

```text
MVP-0 Foundation
  인증, 테넌트, 권한, RLS, 감사 로그, 기본 UI

MVP-1 Deal Workflow
  고객, Opportunity, Qualification, Discovery, Solution Fit, Approval

MVP-2 Quote & Proposal
  제품/SKU, 라인아이템, 마진 계산, Commercial Gate, Proposal Artifact

MVP-3 Asset & Renewal Seed
  고객 자산, 라이선스, 구독, 갱신 알림, Support Case

MVP-4 Controlled AI
  Lead Summary, Discovery Question Generator, Proposal Draft, RCA Draft
```

## 5. 절대 지켜야 할 설계 원칙

```text
1. 모든 데이터는 tenant/company scope를 가진다.
2. request body에서 tenant_id, company_id, approver_persona_id를 신뢰하지 않는다.
3. AI 산출물은 승인 전까지 공식 문서가 아니다.
4. 견적 마진은 사용자가 입력하지 않고 서버가 계산한다.
5. 승인 게이트는 READY 상태에서만 일반 승인 가능하다.
6. AUTO_FAILED override는 CEO + 2인 승인 + 사유가 필요하다.
7. active workflow는 직접 수정하지 않고 새 버전을 만든다.
8. 고객 자산과 라이선스 없이는 갱신 자동화가 불가능하다.
9. Restricted 데이터의 read와 export 권한은 분리한다.
10. 관리자도 완전히 신뢰하지 않는다.
```

## 6. 최종 산출물의 사용 방식

- 경영진: `00_EXECUTIVE`, `09_ROI`
- 제품/기획: `01_SPEC`, `03_BUSINESS`, `06_UX`
- 백엔드 개발자: `02_ARCHITECTURE`, `04_SECURITY`, `10_CODE_SKELETON`
- 프론트엔드 개발자: `06_UX`, `02_ARCHITECTURE/API_Contract.md`
- DevOps/SRE: `07_OPERATIONS`, `04_SECURITY`
- 보안 담당자: `04_SECURITY`, `05_DATA_AI`
- 외주 PM: `08_IMPLEMENTATION`, `README_전체_진행_가이드.md`


## V3.1 보강 적용 안내

V3 최종 패키지 검증 결과에서 확인된 누락 항목을 V3.1에서 보강했다.

읽을 문서:

- `01_SPEC/SPEC-3.1-Code-Skeleton-Governance-Patch.md`
- `02_ARCHITECTURE/Database_ERD_Schema.md`
- `02_ARCHITECTURE/API_Contract.md`
- `05_DATA_AI/Data_Governance.md`
- `05_DATA_AI/AI_Quality_Governance.md`
- `10_CODE_SKELETON/README.md`

V3.1에서 추가된 실행 대상:

```text
- Vendor Request / Discount Request
- PoC Resource / Demo License
- Customer Asset / Asset License / Subscription / Renewal
- Support SLA / Vendor Escalation
- Engineer Certification / Skill Matrix
- Artifact Copy / Download / Export / Watermark Audit
- AI Golden Answer Set / Evaluation Dataset
- OIDC/JWT Auth Adapter Skeleton
```

## V3.1 개발 착수 순서

```text
1. schema.sql을 migration으로 변환
2. rls.sql을 staging DB에 적용
3. OIDC/JWT provider 결정
4. user_company_roles와 role_change_requests 구현
5. customer/opportunity/qualification API 구현
6. quote/discount/vendor request API 구현
7. asset/license/renewal API 구현
8. data export/access audit 구현
9. AI Golden Answer Set seed 작성
10. acceptance test 전체 실행
```


---

# V3.2 추가 사항 — Hermes Color Agent Organization

V3.2에서는 Hermes Agent 협업을 위해 색상 기반 Agent 조직도를 정식으로 추가했다.

```text
Blue   = Technical Direction
Red    = Risk & Safety
Orange = Product & Business Value
Gray   = Documentation & Evidence
Teal   = UX & Visibility
```

사용 방법:

```text
1. 프로젝트별로 5색 Color Agent Cell을 생성한다.
2. 기존 업무 Persona는 그대로 유지한다.
3. Color Agent는 검토 관점과 Kanban handoff 책임자로 사용한다.
4. 모든 handoff는 13_COLOR_AGENT_ORG/Kanban_Handoff_Template.md 형식을 따른다.
5. 모든 업무에 5색 검토를 강제하지 않고, risk-based routing을 적용한다.
```

핵심 문서:

```text
01_SPEC/SPEC-3.2-Hermes-Color-Agent-Organization-Patch.md
02_ARCHITECTURE/Hermes_Color_Agent_Architecture.md
02_ARCHITECTURE/Color_Agent_Kanban_Handoff_Model.md
13_COLOR_AGENT_ORG/
10_CODE_SKELETON/db/color_agents.sql
10_CODE_SKELETON/backend/app/color_agents.py
10_CODE_SKELETON/backend/app/handoffs.py
```
