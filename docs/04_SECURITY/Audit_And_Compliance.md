# Audit & Compliance

## Audit Event Types

| Type | 예시 |
|---|---|
| auth | login, logout, failed login |
| data_read | restricted artifact read |
| data_export | artifact download/export |
| data_write | customer/opportunity/quote update |
| approval | approve/reject/request changes |
| role_change | role grant/revoke |
| workflow_change | workflow definition version |
| ai_action | prompt, output, tool request |
| tool_call | external tool call |
| security_event | RLS failure, policy denial |
| admin_event | config, pack install |

## Audit Schema

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  company_id UUID NOT NULL,
  actor_user_id UUID,
  actor_role TEXT,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  action TEXT NOT NULL,
  request_id TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  redacted_payload JSONB NOT NULL DEFAULT '{}',
  previous_hash TEXT,
  event_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## Hash Chain

```text
event_hash = sha256(previous_hash + canonical_json(event))
```

- 하루 단위 digest 생성
- 외부 immutable storage에 digest 저장
- hash mismatch 발생 시 Security Officer alert

## 보존 원칙

- Audit Log는 일반 삭제 금지
- 관리자도 UPDATE/DELETE 금지
- retention은 법무/회계 정책에 따름
- 개인정보 요청이 있어도 법적 증빙 로그는 redaction/토큰화 후 보존 가능

## Read/Export Audit

다음은 모두 audit 대상이다.

- restricted artifact 조회
- quote export
- customer network diagram download
- support log export
- AI prompt trace 조회
- backup access
- admin impersonation
