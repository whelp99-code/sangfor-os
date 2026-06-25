# Deployment & Operations Guide

## 환경

```text
local
staging
production
```

## 기본 구성

- FastAPI backend
- PostgreSQL
- Redis/Queue
- Object Storage
- Next.js frontend
- Observability stack
- KMS/Secret manager

## 배포 원칙

1. migration은 migrator_role만 수행
2. app_role은 DDL 권한 없음
3. staging에서 RLS integration test 통과 후 production 배포
4. rollback plan 없는 migration 금지
5. feature flag로 AI 기능 단계적 활성화

## CI/CD Checks

```text
lint
type check
unit test
migration test
RLS integration test
API contract test
authorization regression test
approval bypass test
audit hash test
AI output schema test
frontend build
container scan
dependency scan
```

## Observability

필수 지표:

```text
api_latency_p95
workflow_runs_failed_total
approval_queue_age_p95
llm_cost_per_tenant_daily
tool_call_denied_total
audit_hash_mismatch_total
rls_context_missing_total
background_job_retry_total
artifact_decryption_error_total
tenant_storage_usage
```

## Logging Policy

- prompt/response logging default off
- restricted data trace 금지
- PII masking
- APM tag allowlist
- error log redaction
- support bundle 자동 masking

## Backup

- PITR
- encrypted backup
- backup access audit
- restore drill
- tenant-level restore procedure
- backup retention policy

## Incident Severity

| Severity | 예시 |
|---|---|
| SEV1 | tenant data leakage, audit tamper |
| SEV2 | approval system unavailable |
| SEV3 | AI draft failure, single workflow issue |
| SEV4 | minor UI/notification issue |

## Production Readiness Checklist

- [ ] Auth enforced on all APIs
- [ ] RLS enabled and FORCE applied
- [ ] app_role has no BYPASSRLS
- [ ] audit update/delete denied
- [ ] backup encrypted
- [ ] restore drill completed
- [ ] AI budget cap enabled
- [ ] support access policy enabled
- [ ] role grant 2-person approval enabled
- [ ] workflow definition hash enabled
