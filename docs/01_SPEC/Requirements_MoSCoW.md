# Requirements — MoSCoW

## Must Have

| ID | Area | Requirement | Acceptance |
|---|---|---|---|
| M1 | Core | tenant/company/user/persona/role 모델 | 모든 업무 객체가 tenant/company scope를 가진다 |
| M2 | Security | AuthContext 강제 | 인증 없는 API 접근 차단 |
| M3 | Security | RBAC + ABAC | 역할 + 배정 업무 기준으로 접근 제한 |
| M4 | Security | PostgreSQL RLS | 다른 tenant 데이터 조회/수정 실패 |
| M5 | Audit | Append-only audit log | UPDATE/DELETE 불가, hash chain 검증 |
| M6 | Workflow | Workflow Definition/Run | active workflow snapshot 사용 |
| M7 | Approval | Gate 상태 머신 | READY 상태 외 일반 승인 불가 |
| M8 | Artifact | versioning/classification | AI Draft와 Approved 구분 |
| M9 | Business | Customer/Opportunity | 영업 딜 등록과 상태 추적 가능 |
| M10 | Business | Deal Qualification | 예산/권한/필요/일정/기술 적합성 점수 |
| M11 | Business | Product/SKU Catalog | 제품군, SKU, 라이선스 metric 관리 |
| M12 | Commercial | Quote Line Items | 마진 서버 계산 |
| M13 | Commercial | Commercial Gate | 할인/마진 기준 미달 시 승인 필요 |
| M14 | Delivery | Customer Asset | 구축 완료 시 자산/라이선스 생성 |
| M15 | Renewal | Renewal Reminder | 만료일 기준 갱신 업무 생성 |
| M16 | AI | AI Quality Gate | 근거, 누락, confidence, human review 표시 |
| M17 | UX | Role-based dashboard | 역할별 첫 화면 제공 |
| M18 | Ops | Runbook | stuck approval, RLS failure, AI cost spike 대응 절차 |

## Should Have

| ID | Area | Requirement |
|---|---|---|
| S1 | Vendor | Special discount/demo license request |
| S2 | Vendor | Vendor escalation case |
| S3 | Product | Compatibility/sizing templates |
| S4 | Support | SLA policy |
| S5 | Support | RCA workflow |
| S6 | People | Engineer certification matrix |
| S7 | Governance | Retention/legal hold workflow |
| S8 | UX | Approval diff viewer |
| S9 | Ops | Tenant restore drill |
| S10 | ROI | ROI dashboard |

## Could Have

| ID | Requirement |
|---|---|
| C1 | Visual DAG workflow builder |
| C2 | Partner portal API adapter |
| C3 | Industry Pack marketplace |
| C4 | Advanced AI forecast |
| C5 | Multi-vendor product comparison |

## Won't Have in MVP

| ID | Requirement |
|---|---|
| W1 | 고객에게 AI가 직접 제안서 발송 |
| W2 | 완전 자율 CEO 승인 |
| W3 | 완전한 회계/세무 ERP |
| W4 | 모든 SANGFOR 포털 자동 연동 |
| W5 | 대규모 MCP 도구 카탈로그 |
