# Acceptance Criteria & Test Plan

## Security Tests

| Test | Expected |
|---|---|
| 인증 없는 API 호출 | 401 |
| 다른 tenant customer 조회 | 404 또는 403 |
| 다른 company quote 승인 | 403 |
| approver_persona_id body 조작 | 무시 또는 실패 |
| auto_failed approval approve | 실패 |
| System Admin self CEO grant | 실패 |
| audit log update/delete | 실패 |
| RLS context missing query | 실패 |
| restricted export without permission | 실패 |

## Workflow Tests

| Scenario | Expected |
|---|---|
| Qualification 없이 Discovery 진행 | 차단 |
| Solution Fit 실패 후 Proposal 생성 | 차단 |
| Commercial Gate 미승인 quote send | 차단 |
| 승인 후 artifact 수정 | approval stale |
| active workflow 수정 | 차단, 새 version 요구 |

## Business Tests

| Scenario | Expected |
|---|---|
| Opportunity 생성 | Qualification score 생성 가능 |
| SKU 기반 quote | line item 저장 |
| 서비스 원가 누락 | auto_failed |
| margin threshold 미달 | CEO/Finance approval |
| Acceptance 완료 | customer asset/license 생성 |
| subscription 만료 | renewal opportunity 생성 |

## AI Tests

| Scenario | Expected |
|---|---|
| prompt injection 문서 입력 | 위험 flag |
| 근거 없는 제품 추천 | missing info 표시 |
| AI proposal draft | customer send blocked |
| quote draft | server calculation required |
| RCA draft | support lead review required |

## UX Tests

| Role | Expected Home |
|---|---|
| Sales | pipeline, follow-up |
| Presales | discovery, solution fit |
| Finance | commercial queue |
| CEO | revenue/risk dashboard |
| Operator | health/queue/logs |
| Security | access/audit/policy |

## Performance Smoke Tests

- 100 customers
- 1,000 opportunities
- 10,000 artifacts
- 10 concurrent workflow runs
- quote calculation under target latency
- dashboard query paginated

## Definition of Done

- 기능 구현
- 단위 테스트
- 통합 테스트
- 권한 테스트
- RLS 테스트
- audit 테스트
- acceptance scenario 통과
- 문서 업데이트
- staging 배포 검증


## V3.1 추가 Acceptance Criteria

### Business Operations Tests

| Scenario | Expected |
|---|---|
| special discount request 생성 | vendor_required 여부와 approval 상태 저장 |
| demo license 요청 | vendor_request와 demo_license record 생성 |
| PoC success criteria 누락 | PoC Gate 차단 |
| Acceptance 완료 | customer_asset, asset_license, subscription 생성 |
| subscription 90일 전 | renewal_opportunity 자동 생성 |
| support severity critical | SLA due time 자동 계산 |
| vendor escalation 생성 | support_case와 vendor_request 연결 |
| engineer certification 등록 | skill_matrix와 delivery eligibility 검증 가능 |

### Data Governance Tests

| Scenario | Expected |
|---|---|
| restricted artifact view | watermark 표시 |
| restricted artifact copy 시도 | artifact_access_events.copy 기록 |
| restricted artifact download | export approval 없으면 실패 |
| export 승인 완료 | time-limited signed URL 생성 |
| export link 만료 | 다운로드 실패 |
| 퇴사자 role revoke | open opportunity/approval/renewal owner 재배정 요구 |

### AI Quality Tests

| Scenario | Expected |
|---|---|
| Golden Answer Set score 84 | release gate 실패 |
| prompt injection block rate 94% | release gate 실패 |
| restricted leakage 1건 | release gate 실패 |
| source coverage 낮음 | customer_send_allowed=false |
| Quote Review AI가 서비스 원가 누락 탐지 | quality_result risk_flags 기록 |

### Auth / RBAC Tests

| Scenario | Expected |
|---|---|
| privileged role + MFA 미검증 | 403 |
| unsigned JWT | 401 |
| wrong issuer/audience | 401 |
| disabled user | 403 |
| system_admin 자기 CEO 권한 부여 | 실패 |
| role change high risk | 2인 승인 필요 |
