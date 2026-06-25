# Operator Runbook

## 원칙

운영자는 DB row를 직접 수정하지 않는다. 모든 복구는 승인된 admin API, migration, 또는 runbook에 따른다.

## Runbook Index

1. Approval Queue가 멈췄을 때
2. RLS context missing 오류
3. AI 비용 급증
4. Tool Gateway 실패
5. Audit hash mismatch
6. Tenant restore
7. Workflow deadlock
8. Pack installation failure
9. Restricted data exposure 의심
10. Backup restore drill

## 1. Approval Queue Stuck

### 증상

- approval status가 pending/auto_validating에서 오래 멈춤
- 사용자가 승인 버튼을 볼 수 없음

### 확인

1. workflow worker 상태
2. background job queue
3. approval validation logs
4. DB lock
5. tenant rate limit
6. AI validation 실패 여부

### 복구

1. 실패 job 재시도
2. stuck approval 재검증
3. workflow state transition 로그 확인
4. 반복 실패 시 Security Officer + Product Owner escalation

### 금지

- DB에서 approval status 직접 approved로 변경 금지

## 2. RLS Context Missing

### 증상

- DB query가 0건 반환
- `current_setting('app.tenant_id')` 관련 오류
- background job에서만 실패

### 확인

1. API middleware가 context 설정했는지
2. worker payload에 tenant/company/user가 있는지
3. connection pool reset 여부
4. migration role 사용 여부

### 복구

1. worker 재시작
2. context setting middleware 패치
3. RLS integration test 실행

## 3. AI Cost Spike

### 증상

- tenant별 LLM 비용 급증
- queue latency 증가
- large document analysis 반복

### 확인

1. tenant/user별 AI 호출량
2. workflow retry loop
3. prompt token size
4. file upload pattern

### 복구

1. tenant AI budget cap 적용
2. 해당 workflow pause
3. 대형 문서 분석 승인제로 전환
4. 반복 호출 원인 수정

## 4. Audit Hash Mismatch

### 증상

- daily digest 검증 실패
- hash chain mismatch

### 대응

1. 즉시 Security Officer 알림
2. affected time range freeze
3. audit table snapshot
4. DB admin access log 확인
5. external digest와 대조
6. incident report 작성

## 5. Tenant Restore

### 절차

1. restore request 승인
2. tenant impact 분석
3. PITR target 결정
4. staging restore
5. tenant data extraction 검증
6. production apply window 승인
7. restore 완료 후 audit 기록

## 6. Restricted Data Exposure

### 대응

1. access revoke
2. affected artifact export log 확인
3. user/session/token revoke
4. 고객/법무 통지 여부 판단
5. root cause 분석
6. 정책/권한 수정
