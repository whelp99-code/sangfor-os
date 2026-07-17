# Requirements — MoSCoW

이 문서의 Must/Should 표는 구현 분모의 canonical requirement source다. Canonical ID는 `REQ-M1`–`REQ-M18`, `REQ-S1`–`REQ-S10`이고, `M1`·`S1` 같은 표기는 사람이 쓰는 유일한 축약형이다. ID 해석과 precedence는 [Canonical Requirement & Acceptance ID Registry](Requirement_ID_Registry.md)를 따른다.

구현 및 acceptance 분모는 Must 18개와 Should 10개, 합계 28개뿐이다. Could `C1`–`C5`와 Won't `W1`–`W5`는 아이디어/명시적 비범위이며 acceptance 분모와 구현 backlog에서 제외한다.

## Must Have

| Canonical ID | Alias | Area | Requirement | Acceptance |
|---|---|---|---|---|
| REQ-M1 | M1 | Core | tenant/company/user/persona/role 모델 | 모든 업무 객체가 tenant/company scope를 가진다 |
| REQ-M2 | M2 | Security | AuthContext 강제 | 인증 없는 API 접근 차단 |
| REQ-M3 | M3 | Security | RBAC + ABAC | 역할 + 배정 업무 기준으로 접근 제한 |
| REQ-M4 | M4 | Security | PostgreSQL RLS | 다른 tenant 데이터 조회/수정 실패 |
| REQ-M5 | M5 | Audit | Append-only audit log | UPDATE/DELETE 불가, hash chain 검증 |
| REQ-M6 | M6 | Workflow | Workflow Definition/Run | active workflow snapshot 사용 |
| REQ-M7 | M7 | Approval | Gate 상태 머신 | READY 상태 외 일반 승인 불가 |
| REQ-M8 | M8 | Artifact | versioning/classification | AI Draft와 Approved 구분 |
| REQ-M9 | M9 | Business | Customer/Opportunity | 영업 딜 등록과 상태 추적 가능 |
| REQ-M10 | M10 | Business | Deal Qualification | 예산/권한/필요/일정/기술 적합성 점수 |
| REQ-M11 | M11 | Business | Product/SKU Catalog | 제품군, SKU, 라이선스 metric 관리 |
| REQ-M12 | M12 | Commercial | Quote Line Items | 마진 서버 계산 |
| REQ-M13 | M13 | Commercial | Commercial Gate | 할인/마진 기준 미달 시 승인 필요 |
| REQ-M14 | M14 | Delivery | Customer Asset | 구축 완료 시 자산/라이선스 생성 |
| REQ-M15 | M15 | Renewal | Renewal Reminder | 만료일 기준 갱신 업무 생성 |
| REQ-M16 | M16 | AI | AI Quality Gate | 근거, 누락, confidence, human review 표시 |
| REQ-M17 | M17 | UX | Role-based dashboard | 역할별 첫 화면 제공 |
| REQ-M18 | M18 | Ops | Runbook | stuck approval, RLS failure, AI cost spike 대응 절차 |

## Should Have

| Canonical ID | Alias | Area | Requirement |
|---|---|---|---|
| REQ-S1 | S1 | Vendor | Special discount/demo license request |
| REQ-S2 | S2 | Vendor | Vendor escalation case |
| REQ-S3 | S3 | Product | Compatibility/sizing templates |
| REQ-S4 | S4 | Support | SLA policy |
| REQ-S5 | S5 | Support | RCA workflow |
| REQ-S6 | S6 | People | Engineer certification matrix |
| REQ-S7 | S7 | Governance | Retention/legal hold workflow |
| REQ-S8 | S8 | UX | Approval diff viewer |
| REQ-S9 | S9 | Ops | Tenant restore drill |
| REQ-S10 | S10 | ROI | ROI dashboard |

## Could Have — excluded from implementation and acceptance denominators

| Excluded ID | Requirement |
|---|---|
| C1 | Visual DAG workflow builder |
| C2 | Partner portal API adapter |
| C3 | Industry Pack marketplace |
| C4 | Advanced AI forecast |
| C5 | Multi-vendor product comparison |

## Won't Have in MVP — excluded from implementation and acceptance denominators

| Excluded ID | Requirement |
|---|---|
| W1 | 고객에게 AI가 직접 제안서 발송 |
| W2 | 완전 자율 CEO 승인 |
| W3 | 완전한 회계/세무 ERP |
| W4 | 모든 SANGFOR 포털 자동 연동 |
| W5 | 대규모 MCP 도구 카탈로그 |
