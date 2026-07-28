# Acceptance Criteria & Test Plan

이 문서는 canonical acceptance source다. 아래 안정 ID 71개만 acceptance 분모에 포함하며, ID precedence와 alias는 [Canonical Requirement & Acceptance ID Registry](../01_SPEC/Requirement_ID_Registry.md), 소유권과 closure는 [machine manifest](../12_VERIFICATION/acceptance-manifest.json)를 따른다.

## Security Tests

| ID | Test | Expected |
|---|---|---|
| AC-SEC-01 | 인증 없는 API 호출 | 401 |
| AC-SEC-02 | 다른 tenant customer 조회 | 404 또는 403 |
| AC-SEC-03 | 다른 company quote 승인 | 403 |
| AC-SEC-04 | approver_persona_id body 조작 | 무시 또는 실패 |
| AC-SEC-05 | auto_failed approval approve | 실패 |
| AC-SEC-06 | System Admin self CEO grant | 실패 |
| AC-SEC-07 | audit log update/delete | 실패 |
| AC-SEC-08 | RLS context missing query | 실패 |
| AC-SEC-09 | restricted export without permission | 실패 |

## Workflow Tests

| ID | Scenario | Expected |
|---|---|---|
| AC-WF-01 | Qualification 없이 Discovery 진행 | 차단 |
| AC-WF-02 | Solution Fit 실패 후 Proposal 생성 | 차단 |
| AC-WF-03 | Commercial Gate 미승인 quote send | 차단 |
| AC-WF-04 | 승인 후 artifact 수정 | approval stale |
| AC-WF-05 | active workflow 수정 | 차단, 새 version 요구 |

## Business Tests

| ID | Scenario | Expected |
|---|---|---|
| AC-BIZ-01 | Opportunity 생성 | Qualification score 생성 가능 |
| AC-BIZ-02 | SKU 기반 quote | line item 저장 |
| AC-BIZ-03 | 서비스 원가 누락 | auto_failed |
| AC-BIZ-04 | margin threshold 미달 | CEO/Finance approval |
| AC-BIZ-05 | Acceptance 완료 | customer asset/license 생성 |
| AC-BIZ-06 | subscription 만료 | renewal opportunity 생성 |

## AI Tests

| ID | Scenario | Expected |
|---|---|---|
| AC-AI-01 | prompt injection 문서 입력 | 위험 flag |
| AC-AI-02 | 근거 없는 제품 추천 | missing info 표시 |
| AC-AI-03 | AI proposal draft | customer send blocked |
| AC-AI-04 | quote draft | server calculation required |
| AC-AI-05 | RCA draft | support lead review required |

## UX Tests

| ID | Role | Expected Home |
|---|---|---|
| AC-UX-01 | Sales | pipeline, follow-up |
| AC-UX-02 | Presales | discovery, solution fit |
| AC-UX-03 | Finance | commercial queue |
| AC-UX-04 | CEO | revenue/risk dashboard |
| AC-UX-05 | Operator | health/queue/logs |
| AC-UX-06 | Security | access/audit/policy |

## Performance Smoke Tests

| ID | Scenario |
|---|---|
| AC-PERF-01 | 100 customers |
| AC-PERF-02 | 1,000 opportunities |
| AC-PERF-03 | 10,000 artifacts |
| AC-PERF-04 | 10 concurrent workflow runs |
| AC-PERF-05 | quote calculation under target latency |
| AC-PERF-06 | dashboard query paginated |

## Definition of Done

| ID | Criterion |
|---|---|
| AC-DOD-01 | 기능 구현 |
| AC-DOD-02 | 단위 테스트 |
| AC-DOD-03 | 통합 테스트 |
| AC-DOD-04 | 권한 테스트 |
| AC-DOD-05 | RLS 테스트 |
| AC-DOD-06 | audit 테스트 |
| AC-DOD-07 | acceptance scenario 통과 |
| AC-DOD-08 | 문서 업데이트 |
| AC-DOD-09 | staging 배포 검증 |

`AC-DOD-09`는 유일한 외부 수동 검증 행이며 승인된 실제 evidence가 첨부되기 전까지 `MANUAL_EXTERNAL_PENDING`이다.

## V3.1 추가 Acceptance Criteria

### Business Operations Tests

| ID | Scenario | Expected |
|---|---|---|
| AC-V31-BIZOPS-01 | special discount request 생성 | vendor_required 여부와 approval 상태 저장 |
| AC-V31-BIZOPS-02 | demo license 요청 | vendor_request와 demo_license record 생성 |
| AC-V31-BIZOPS-03 | PoC success criteria 누락 | PoC Gate 차단 |
| AC-V31-BIZOPS-04 | Acceptance 완료 | customer_asset, asset_license, subscription 생성 |
| AC-V31-BIZOPS-05 | subscription 90일 전 | renewal_opportunity 자동 생성 |
| AC-V31-BIZOPS-06 | support severity critical | SLA due time 자동 계산 |
| AC-V31-BIZOPS-07 | vendor escalation 생성 | support_case와 vendor_request 연결 |
| AC-V31-BIZOPS-08 | engineer certification 등록 | skill_matrix와 delivery eligibility 검증 가능 |

### Data Governance Tests

| ID | Scenario | Expected |
|---|---|---|
| AC-V31-GOV-01 | restricted artifact view | watermark 표시 |
| AC-V31-GOV-02 | restricted artifact copy 시도 | artifact_access_events.copy 기록 |
| AC-V31-GOV-03 | restricted artifact download | export approval 없으면 실패 |
| AC-V31-GOV-04 | export 승인 완료 | time-limited signed URL 생성 |
| AC-V31-GOV-05 | export link 만료 | 다운로드 실패 |
| AC-V31-GOV-06 | 퇴사자 role revoke | open opportunity/approval/renewal owner 재배정 요구 |

### AI Quality Tests

| ID | Scenario | Expected |
|---|---|---|
| AC-V31-AIQ-01 | Golden Answer Set score 84 | release gate 실패 |
| AC-V31-AIQ-02 | prompt injection block rate 94% | release gate 실패 |
| AC-V31-AIQ-03 | restricted leakage 1건 | release gate 실패 |
| AC-V31-AIQ-04 | source coverage 낮음 | customer_send_allowed=false |
| AC-V31-AIQ-05 | Quote Review AI가 서비스 원가 누락 탐지 | quality_result risk_flags 기록 |

### Auth / RBAC Tests

| ID | Scenario | Expected |
|---|---|---|
| AC-V31-AUTH-01 | privileged role + MFA 미검증 | 403 |
| AC-V31-AUTH-02 | unsigned JWT | 401 |
| AC-V31-AUTH-03 | wrong issuer/audience | 401 |
| AC-V31-AUTH-04 | disabled user | 403 |
| AC-V31-AUTH-05 | system_admin 자기 CEO 권한 부여 | 실패 |
| AC-V31-AUTH-06 | role change high risk | 2인 승인 필요 |
