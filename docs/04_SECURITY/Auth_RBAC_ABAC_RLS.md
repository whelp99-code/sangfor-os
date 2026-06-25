# Auth, RBAC, ABAC & RLS

## AuthContext

모든 API는 다음 context를 가진다.

```python
class AuthContext(BaseModel):
    user_id: UUID
    tenant_id: UUID
    company_id: UUID
    roles: list[str]
    personas: list[str]
    clearance: str
```

## 금지 사항

```text
1. request body에서 tenant_id를 받지 않는다.
2. request body에서 company_id를 받지 않는다.
3. request body에서 approver_persona_id를 받지 않는다.
4. db.get(Model, id) 단독 조회를 금지한다.
5. 관리자 권한만으로 business approval을 허용하지 않는다.
```

## RBAC

| Role | 권한 |
|---|---|
| CEO | high-risk approval, executive dashboard |
| Sales Manager | customer/opportunity, sales approval |
| Account Manager | renewal, customer lifecycle |
| Presales Engineer | discovery, solution fit |
| Solution Architect | architecture review |
| Finance Manager | quote/margin approval |
| Delivery Engineer | deployment artifacts |
| Support Engineer | support/RCA |
| Security Officer | security review, audit |
| System Admin | user/config admin, no business approval by default |

## ABAC 조건

권한은 역할만으로 충분하지 않다.

```text
allow if:
  role has permission
  AND tenant/company match
  AND user assigned to customer/opportunity OR clearance sufficient
  AND artifact classification <= clearance
  AND action allowed for current workflow state
```

## PostgreSQL RLS

```sql
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE opportunities FORCE ROW LEVEL SECURITY;

CREATE POLICY opportunities_tenant_company_policy
ON opportunities
USING (
  tenant_id::text = current_setting('app.tenant_id', true)
  AND company_id::text = current_setting('app.company_id', true)
)
WITH CHECK (
  tenant_id::text = current_setting('app.tenant_id', true)
  AND company_id::text = current_setting('app.company_id', true)
);
```

## DB Session Context

API request 시작 시:

```sql
SELECT set_config('app.tenant_id', :tenant_id, true);
SELECT set_config('app.company_id', :company_id, true);
SELECT set_config('app.user_id', :user_id, true);
```

current_setting이 없으면 default deny되어야 한다.

## Privileged Access Management

### 자기 권한 상승 금지

```text
System Admin은 본인에게 CEO, Finance, Security Officer 권한을 부여할 수 없다.
```

### 고위험 역할 부여

필수:

- requester
- approver 1
- approver 2
- reason
- expiry time
- audit alert

## Support Access

운영자/지원자가 고객 데이터에 접근할 때:

- JIT access
- ticket reference
- time-limited
- read-only default
- restricted data masking
- access reason required
