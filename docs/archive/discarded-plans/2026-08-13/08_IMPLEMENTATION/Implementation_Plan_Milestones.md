# Implementation Plan & Milestones

## 구현 전략

한 번에 전체 플랫폼을 만들지 않는다. 수익과 통제에 직접 연결되는 순서로 구현한다.

## Milestone 0 — Foundation

### 범위

- Tenant / Company
- User / AuthContext
- Role / Permission
- PostgreSQL RLS
- Audit Log
- Basic Dashboard
- CI/CD skeleton

### 완료 기준

- 인증 없는 API 접근 차단
- 다른 tenant 데이터 접근 실패
- audit log 기록
- RLS integration test 통과

## Milestone 1 — Deal Workflow

### 범위

- Customer
- Opportunity
- Deal Qualification
- Workflow Run
- Discovery Note
- Solution Fit Matrix
- Approval Gate

### 완료 기준

- Opportunity 등록 가능
- Qualification score 생성
- Discovery Artifact version 생성
- Solution Fit Gate 승인/반려 가능
- AI Draft와 Approved Artifact 분리

## Milestone 2 — Quote & Commercial

### 범위

- Product Family
- Product SKU
- Quote
- Quote Line Items
- Margin Calculation
- Commercial Gate
- Proposal Artifact

### 완료 기준

- 서버 계산 마진 표시
- 낮은 마진 자동 경고
- Commercial Gate 승인 전 고객 발송 차단
- quote version immutable

## Milestone 3 — Delivery, Asset & Renewal Seed

### 범위

- PoC Plan/Result
- Delivery Checklist
- Customer Asset
- License/Subscription
- Renewal Reminder
- Support Case

### 완료 기준

- Acceptance 후 asset/license 생성
- subscription 만료일 기준 renewal opportunity 생성
- support case가 asset에 연결됨

## Milestone 4 — Controlled AI

### 범위

- Lead Summary
- Discovery Question Generator
- Proposal Draft
- RCA Draft
- AI Quality Gate
- Prompt/Model Registry

### 완료 기준

- AI Draft 고객 발송 차단
- source artifact 표시
- missing fields 표시
- human review required 표시

## Milestone 5 — Operations & ROI

### 범위

- Operator Console
- Security Console
- ROI Dashboard
- AI cost dashboard
- Runbook automation

### 완료 기준

- approval queue age 확인
- LLM cost per tenant 확인
- audit hash mismatch alert
- renewal recovered amount 측정

## 의존성

```text
Foundation 없이는 Workflow 금지
Workflow 없이는 Approval 금지
Product/SKU 없이는 Quote 금지
Asset 없이는 Renewal 금지
AI Quality Gate 없이는 고객 발송 AI 금지
```
