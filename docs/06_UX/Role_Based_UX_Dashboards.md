# Role-Based UX & Dashboards

## UX 원칙

1. 사용자는 기술 용어가 아니라 업무 언어를 본다.
2. 역할별 첫 화면이 달라야 한다.
3. AI Draft와 Approved Artifact는 강하게 분리한다.
4. 승인 화면은 diff, 위험, 자동 검증 결과를 먼저 보여준다.
5. 운영자 화면과 업무자 화면은 분리한다.
6. 관리자는 “누가 문제인가”보다 “어디가 막혔는가”를 본다.

## 사용자별 Home

### Sales Manager

```text
Sales Home
├── 내 Pipeline
├── 오늘 follow-up
├── 승인 대기 Opportunity
├── 제안서 작성 중
├── 갱신 예정 고객
└── 위험 딜
```

### Presales Engineer

```text
Presales Home
├── Discovery 대기
├── Solution Fit 검토
├── Sizing 누락 항목
├── PoC 준비
└── AI Draft 검토 필요
```

### Finance Manager

```text
Finance Home
├── Commercial Approval Queue
├── 낮은 마진 딜
├── 높은 할인 요청
├── 견적 diff
└── 예외 payment term
```

### Delivery Engineer

```text
Delivery Home
├── 구축 예정
├── SOW 확인 필요
├── License activation 필요
├── Acceptance checklist
└── Handover 문서
```

### Support Engineer

```text
Support Home
├── 신규 Ticket
├── SLA 임박
├── Vendor escalation
├── RCA 작성 필요
└── 반복 장애 고객
```

### CEO / Executive

```text
Executive Dashboard
├── Revenue Pipeline
├── Product-family Forecast
├── Gross Margin Risk
├── Approval Bottleneck
├── PoC Success Rate
├── Delivery Delay
├── Support Hotspots
├── Renewal Forecast
└── Security/Privilege Alerts
```

### Operator

```text
Operator Console
├── System Health
├── Tenant Health
├── Workflow Queue
├── AI/LLM Usage
├── Tool Gateway Logs
├── Failed Jobs
├── RLS Policy Check
├── Audit Chain Integrity
└── Backup Status
```

### Security Officer

```text
Security Console
├── Restricted Data Access
├── Role Changes
├── Privileged Access
├── Audit Mismatch
├── AI Policy Violations
├── Export Events
└── Workflow Definition Changes
```

## Approval Decision Page

필수 구성:

```text
Approval Decision
├── 승인 대상 요약
├── 고객/Opportunity 정보
├── 변경 Diff
├── 자동 검증 결과
├── 실패/경고 항목
├── 예상 매출/마진
├── 관련 Artifact
├── AI 생성 여부
├── 이전 승인 이력
├── 담당자 의견
└── Approve / Reject / Request Changes / Escalate
```

## 상태 표시명

| Internal | User Display |
|---|---|
| pending | 대기 |
| auto_validating | 자동 검증 중 |
| auto_failed | 자동 검증 실패 |
| remediation_required | 수정 필요 |
| ready_for_human_approval | 승인 대기 |
| approved | 승인 완료 |
| rejected | 반려 |
| stale | 재검토 필요 |
| ai_draft | AI 초안 |
| human_reviewed | 사람 검토 완료 |

## 검색/필터

필수 필터:

- 고객명
- 제품군
- 담당자
- Deal 단계
- 승인 상태
- Artifact 타입
- 날짜
- 마진율
- 리스크 레벨
- 갱신 예정일
- SLA 상태

## Empty State

예:

```text
아직 갱신 대상 고객이 없습니다.
구축 완료 후 Customer Asset과 Subscription이 생성되면 이 화면에 표시됩니다.
```
