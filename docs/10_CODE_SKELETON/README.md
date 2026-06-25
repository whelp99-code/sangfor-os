# Code Skeleton

이 폴더는 외주 개발팀이 시작점으로 사용할 수 있는 뼈대 코드다. 운영 배포 가능한 완성 코드는 아니며, 반드시 보안 검토와 테스트를 거쳐야 한다.

## Structure

```text
backend/
  app/main.py
  app/auth.py
  app/policies.py
  app/approvals.py
  app/quotes.py

db/
  schema.sql
  rls.sql

seed/
  sangfor_industry_pack_v3.json

frontend/
  app/page.tsx
```

## 핵심 구현 원칙

- 모든 API는 AuthContext를 받는다.
- tenant_id/company_id는 request body에서 받지 않는다.
- DB query는 scoped repository를 사용한다.
- RLS session config를 request 시작 시 설정한다.
- approval decision은 state machine을 통과한다.
- quote margin은 서버에서 계산한다.


## V3.1 보강 범위

V3.1 code skeleton은 이전 coverage gap을 보완하기 위해 다음을 추가했다.

```text
backend/app/vendor.py
backend/app/assets.py
backend/app/renewals.py
backend/app/certifications.py
backend/app/data_exports.py
backend/app/ai_quality.py
backend/app/poc.py
```

추가 API skeleton:

```text
POST /api/opportunities/{id}/qualification
POST /api/opportunities/{id}/vendor-requests
POST /api/quotes/{id}/discount-requests
POST /api/demo-licenses
POST /api/poc-projects
POST /api/poc-resources
POST /api/customer-assets
POST /api/asset-licenses
POST /api/renewal-opportunities/generate
POST /api/support-cases/{id}/vendor-escalations
POST /api/engineer-certifications
POST /api/skill-matrix
POST /api/artifacts/{id}/export-requests
POST /api/ai/evaluations/run
```

추가 DB coverage:

```text
Core workflow tables, vendor request tables, discount/demo license tables,
PoC/delivery tables, customer asset/license/subscription/renewal tables,
support SLA/vendor escalation tables, engineer certification/skill matrix,
data export/access audit tables, AI prompt/model/evaluation/golden answer tables.
```

## Auth Skeleton 상태

`backend/app/auth.py`는 OIDC/JWT verifier adapter 구조까지 포함한다. 실제 IdP 연동은 외주 개발 Phase 0에서 다음 중 하나로 구현한다.

```text
- Auth0 / Azure AD / Keycloak / Cognito 등 OIDC provider
- JWKS signature verification
- issuer / audience / expiration 검증
- disabled user DB check
- privileged role MFA enforcement
```

운영 전까지 verifier는 fail-closed 상태여야 하며, unsigned token 또는 dev-only bypass는 production build에 포함하면 안 된다.


## V3.2 Color Agent Skeleton

추가 파일:

```text
db/color_agents.sql
seed/color_agent_registry_v3_2.json
backend/app/color_agents.py
backend/app/handoffs.py
backend/app/color_review_gates.py
frontend/app/color-agents/page.tsx
```

추가 API skeleton:

```text
POST /api/color-agents/route
POST /api/kanban/handoffs
POST /api/kanban/handoffs/{handoff_id}/decision
POST /api/color-review-gates/check
```
