# API Contract

## 공통 원칙

1. 모든 API는 AuthContext를 요구한다.
2. client request body의 tenant_id/company_id를 신뢰하지 않는다.
3. 서버가 AuthContext에서 tenant_id/company_id를 주입한다.
4. 모든 response에는 request_id를 포함한다.
5. object id 기반 조회는 반드시 tenant/company scope로 필터링한다.

## AuthContext

```json
{
  "user_id": "uuid",
  "tenant_id": "uuid",
  "company_id": "uuid",
  "roles": ["sales_manager"],
  "personas": ["sales_manager"],
  "clearance": "confidential"
}
```

## 공통 Error Schema

```json
{
  "request_id": "req_...",
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have access to this object.",
    "details": {}
  }
}
```

## Customers

### POST /api/customers

Request:

```json
{
  "name": "ABC Corporation",
  "segment": "enterprise",
  "industry": "finance",
  "primary_contact": {
    "name": "Kim",
    "email": "kim@example.com"
  }
}
```

Response:

```json
{
  "id": "uuid",
  "name": "ABC Corporation",
  "status": "active"
}
```

## Opportunities

### POST /api/opportunities

```json
{
  "customer_id": "uuid",
  "title": "NGFW Renewal and XDR Expansion",
  "estimated_revenue": 120000000,
  "expected_close_date": "2026-12-31",
  "product_family_keys": ["ngfw", "xdr"],
  "competitor": "unknown",
  "pain_points": ["ransomware", "vpn_policy"]
}
```

## Deal Qualification

### POST /api/opportunities/{id}/qualification

```json
{
  "budget_confidence": 4,
  "authority_confirmed": true,
  "need_score": 5,
  "timeline_score": 3,
  "technical_fit_score": 4,
  "competitive_risk": "medium",
  "notes": "Decision maker identified, budget range pending."
}
```

## Artifacts

### POST /api/workflow-runs/{id}/artifacts

```json
{
  "artifact_type": "discovery_note",
  "title": "Discovery Note v1",
  "classification": "confidential",
  "body_markdown": "..."
}
```

## Approvals

### POST /api/approvals/{id}/decision

Request:

```json
{
  "decision": "approved",
  "comment": "Margin and technical fit reviewed."
}
```

주의:

- approver_persona_id는 request body에 없다.
- 서버가 AuthContext에서 승인자를 결정한다.
- 상태가 `ready_for_human_approval`가 아니면 일반 승인 실패.

## Quotes

### POST /api/opportunities/{id}/quotes

```json
{
  "currency": "KRW",
  "line_items": [
    {
      "line_type": "product",
      "product_sku_id": "uuid",
      "description": "SANGFOR NGFW subscription",
      "quantity": 1,
      "unit_price": 50000000,
      "unit_cost": 35000000,
      "discount_percent": 10
    },
    {
      "line_type": "service",
      "description": "Implementation service",
      "quantity": 5,
      "unit_price": 1200000,
      "unit_cost": 800000,
      "discount_percent": 0
    }
  ]
}
```

Response includes server calculation:

```json
{
  "quote_id": "uuid",
  "revenue": 51000000,
  "cost": 39000000,
  "margin_percent": 23.53,
  "requires_commercial_approval": true
}
```

## AI Draft

### POST /api/ai/drafts/proposal

```json
{
  "opportunity_id": "uuid",
  "source_artifact_ids": ["uuid"],
  "draft_goal": "customer_proposal"
}
```

Response:

```json
{
  "artifact_id": "uuid",
  "status": "ai_draft",
  "quality": {
    "confidence": "medium",
    "missing_fields": ["budget", "endpoint_count"],
    "source_coverage": 0.72,
    "requires_human_review": true
  }
}
```


## V3.1 추가 API — Vendor / Renewal / Certification / Data Export

### POST /api/opportunities/{id}/vendor-requests

벤더/총판/파트너 포털 요청을 시스템에 기록한다. MVP에서는 외부 포털 API 직접 연동이 아니라 수동 상태 추적을 기본으로 한다.

```json
{
  "request_type": "special_discount",
  "vendor_key": "sangfor",
  "payload": {
    "discount_reason": "competitive deal",
    "requested_discount_percent": 15,
    "expected_close_date": "2026-12-31"
  }
}
```

### POST /api/quotes/{id}/discount-requests

```json
{
  "requested_discount_percent": 15,
  "reason": "Strategic customer with competitor pressure",
  "vendor_required": true
}
```

### POST /api/poc-projects

```json
{
  "opportunity_id": "uuid",
  "success_criteria": [
    "NGFW policy migration validated",
    "VPN performance baseline accepted"
  ],
  "test_scenarios": [
    "site-to-site vpn",
    "malware policy block"
  ],
  "customer_approver": "Customer IT Manager",
  "start_date": "2026-08-01",
  "end_date": "2026-08-14"
}
```

### POST /api/customer-assets

Acceptance Gate 완료 후 고객 자산/라이선스/갱신 일정을 생성한다.

```json
{
  "customer_id": "uuid",
  "product_sku_id": "uuid",
  "asset_name": "SANGFOR NGFW HQ",
  "serial_number": "masked-or-reference",
  "installed_at": "2026-09-01",
  "subscription": {
    "start_date": "2026-09-01",
    "end_date": "2027-08-31"
  }
}
```

### POST /api/renewal-opportunities/generate

만료일 기준으로 갱신 opportunity를 생성한다.

```json
{
  "days_ahead": 90
}
```

### POST /api/support-cases/{id}/vendor-escalations

```json
{
  "severity": "high",
  "external_ticket_ref": "SANGFOR-PORTAL-REF",
  "notes": "Customer production outage, workaround applied."
}
```

### POST /api/engineer-certifications

```json
{
  "user_id": "uuid",
  "vendor_key": "sangfor",
  "certification_key": "sangfor_hci_professional",
  "certification_name": "SANGFOR HCI Professional",
  "product_family_id": "uuid",
  "issued_at": "2026-01-01",
  "expires_at": "2028-01-01"
}
```

### POST /api/artifacts/{id}/export-requests

```json
{
  "export_format": "pdf",
  "reason": "Customer-approved proposal delivery"
}
```

주의:

- read 권한은 export 권한을 의미하지 않는다.
- Restricted artifact export는 manager/security approval을 요구한다.
- 모든 copy/download/export/share/print는 `artifact_access_events`에 기록한다.

### POST /api/ai/evaluations/run

```json
{
  "prompt_template_id": "uuid",
  "model_id": "uuid",
  "dataset_id": "uuid"
}
```

Response:

```json
{
  "score": 87.5,
  "passed": true,
  "failed_cases": [],
  "release_gate": "passed"
}
```
