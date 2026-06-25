# SPEC-3.1-Code-Skeleton-Governance-Patch

## 목적

본 문서는 최종 패키지 V3 검증에서 발견된 coverage gap을 보강하기 위한 V3.1 패치 문서다.

## 보강 목표

```text
문서 반영률: 100%
MVP code skeleton 반영률: 100%
외주 개발 착수 가능성: Contractor-ready
```

단, 여기서 100%는 **우리가 합의한 설계 항목이 문서와 skeleton에 빠짐없이 존재한다는 의미**다. 운영 배포 가능한 완성 구현을 의미하지 않는다.

## 반영된 Gap

| Gap | V3 상태 | V3.1 조치 |
|---|---|---|
| vendor_requests / events 누락 | 문서만 있음 | schema, RLS, API skeleton 추가 |
| discount_requests 누락 | 문서만 있음 | schema, API skeleton 추가 |
| demo_licenses / PoC resource 누락 | 문서만 있음 | schema, API skeleton 추가 |
| renewal_opportunities 누락 | 문서만 있음 | schema, API skeleton 추가 |
| asset_licenses 누락 | 문서만 있음 | schema, API skeleton 추가 |
| support_sla_policies / vendor_escalations 누락 | 문서만 있음 | schema, API skeleton 추가 |
| engineer_certifications / skill_matrix 누락 | 문서만 있음 | schema, API skeleton 추가 |
| deal_qualification_scores 누락 | 문서만 있음 | schema, API skeleton 추가 |
| AI Golden Answer Set 명시 부족 | 부분 반영 | AI Quality 문서, schema 추가 |
| copy/download/watermark 정책 부족 | 부분 반영 | Data Governance, schema, API 추가 |
| Auth placeholder | fail-closed TODO | OIDC/JWT adapter skeleton + MFA enforcement 추가 |

## 추가된 Core Tables

```text
user_company_roles
role_change_requests
personas
industry_packs
workflow_definitions
workflow_runs
tasks
approval_override_requests
artifact_access_events
data_export_requests
```

## 추가된 Business Tables

```text
competitors
deal_qualification_scores
license_metrics
sizing_templates
compatibility_rules
quote_service_line_items
discount_requests
vendor_requests
vendor_request_events
poc_projects
poc_resources
demo_licenses
delivery_projects
asset_licenses
maintenance_contracts
renewal_opportunities
support_sla_policies
vendor_escalations
engineer_certifications
skill_matrix
```

## 추가된 AI/Data Governance Tables

```text
ai_prompt_templates
ai_models
ai_evaluation_datasets
ai_golden_answers
ai_quality_results
ai_prompt_runs
artifact_access_events
data_export_requests
```

## V3.1 외주 개발 착수 기준

1. 외주팀은 `README_전체_진행_가이드.md`를 먼저 읽는다.
2. DB 담당자는 `02_ARCHITECTURE/Database_ERD_Schema.md`와 `10_CODE_SKELETON/db/schema.sql`를 기준으로 migration을 작성한다.
3. 백엔드 담당자는 `02_ARCHITECTURE/API_Contract.md`와 `10_CODE_SKELETON/backend/app`를 기준으로 endpoint를 구현한다.
4. 보안 담당자는 `04_SECURITY/Auth_RBAC_ABAC_RLS.md`, `10_CODE_SKELETON/db/rls.sql`, `backend/app/auth.py`를 검증한다.
5. AI 담당자는 `05_DATA_AI/AI_Quality_Governance.md`와 AI evaluation tables를 기준으로 Golden Answer Set을 만든다.
6. 데이터 담당자는 `05_DATA_AI/Data_Governance.md`를 기준으로 export/copy/download/watermark 정책을 구현한다.

## Definition of Coverage Done

```text
- 합의된 엔티티가 schema.sql에 존재
- tenant/company scoped table에 RLS skeleton 존재
- 합의된 API가 API Contract와 backend skeleton에 존재
- AI Golden Answer Set 문서와 DB 모델 존재
- Data Export/Copy/Download/Watermark 정책 문서와 DB 모델 존재
- Auth skeleton이 OIDC/JWT adapter 구조와 MFA enforcement를 포함
- Coverage Check Report에서 gap이 없음
```
