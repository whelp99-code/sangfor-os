# Contractor Work Packages

## Team Structure

| 역할 | 책임 |
|---|---|
| Product Architect | SPEC/업무 흐름/우선순위 |
| Backend Lead | API, DB, workflow, approval |
| Security Engineer | Auth/RLS/audit/threat tests |
| Frontend Lead | role dashboard, approval UX |
| DevOps Engineer | CI/CD, infra, monitoring |
| AI Engineer | AI draft, prompt registry, quality gate |
| QA Engineer | E2E, security regression, acceptance |

## Work Package 1 — Backend Foundation

Deliverables:

- FastAPI project
- AuthContext middleware
- tenant/company scoped repository
- RLS session context
- audit service
- role/permission service

Acceptance:

- BOLA test 실패 처리
- auth required
- audit records generated

## Work Package 2 — Workflow & Approval

Deliverables:

- workflow_definitions
- workflow_runs
- approval state machine
- approval decision API
- workflow version hash

Acceptance:

- auto_failed 일반 승인 불가
- stale artifact approval 차단
- active workflow direct edit 금지

## Work Package 3 — SANGFOR Business Pack

Deliverables:

- industry pack seed
- personas
- workflow templates
- product families
- artifact templates
- approval rules

Acceptance:

- seed install 후 SANGFOR workflow 생성 가능

## Work Package 4 — Quote Engine

Deliverables:

- product_skus
- quote_line_items
- margin calculation
- commercial rule engine
- quote versioning

Acceptance:

- margin user input 무시
- server-side calculation
- low margin approval required

## Work Package 5 — Frontend UX

Deliverables:

- Sales Home
- Presales Home
- Finance Queue
- CEO Dashboard
- Operator Console
- Artifact Viewer
- Approval Page

Acceptance:

- AI Draft와 Approved 구분
- approval diff 표시
- role별 home 구분

## Work Package 6 — AI Quality

Deliverables:

- AI gateway
- prompt registry
- model registry
- quality gate
- AI draft artifact flow

Acceptance:

- customer send blocked until approved
- missing fields 표시
- evidence links 표시

## Work Package 7 — Operations

Deliverables:

- deployment manifest
- monitoring dashboard
- backup/restore procedure
- incident runbooks
- audit hash verifier

Acceptance:

- staging restore drill
- audit hash check
- AI cost limit alert


## V3.1 추가 Work Packages

### WP-10 Vendor & Partner Portal Operations

Scope:

```text
vendor_requests
vendor_request_events
discount_requests
demo_licenses
manual partner portal reference tracking
```

Acceptance:

```text
special discount, demo license, technical escalation request를 생성/상태변경/감사 가능
```

### WP-11 Asset / License / Renewal Operations

Scope:

```text
customer_assets
asset_licenses
subscriptions
maintenance_contracts
renewal_opportunities
90/60/30 day renewal automation
```

Acceptance:

```text
Acceptance Gate 완료 시 고객 자산과 갱신 스케줄이 생성됨
```

### WP-12 Certification / Skill Matrix

Scope:

```text
engineer_certifications
skill_matrix
delivery eligibility check
```

Acceptance:

```text
제품군별 presales/delivery/support 가능 엔지니어를 조회 가능
```

### WP-13 Data Export Governance

Scope:

```text
artifact_access_events
data_export_requests
watermark
copy/download/export audit
signed URL expiry
```

Acceptance:

```text
Restricted artifact export는 승인 없이는 불가능하고 모든 접근 이벤트가 기록됨
```

### WP-14 AI Quality Evaluation

Scope:

```text
ai_prompt_templates
ai_models
ai_evaluation_datasets
ai_golden_answers
ai_quality_results
ai_prompt_runs
release gate
```

Acceptance:

```text
새 prompt/model 조합은 Golden Answer Set 평가 통과 전 운영 반영 불가
```
