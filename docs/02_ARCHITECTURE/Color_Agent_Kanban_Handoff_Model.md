# Color Agent Kanban Handoff Model

## 목적

Kanban Handoff는 Agent가 자기 책임 밖의 판단을 공식적으로 다른 Color Agent에게 넘기는 표준 절차다.

## Handoff Card 상태

```text
draft
 → submitted
 → accepted
 → in_review
 → changes_requested
 → resolved
 → rejected
 → archived
```

## Handoff Card 필드

| 필드 | 설명 |
|---|---|
| project_id | handoff가 속한 프로젝트 |
| from_color | 요청한 Color Agent |
| to_color | 받을 Color Agent |
| type | review, decision, clarification, risk_check, ux_check, evidence_check |
| priority | low, medium, high, critical |
| context | 현재 상황 |
| decision_needed | 필요한 판단 |
| constraints | 제약 조건 |
| suggested_answer | 요청 Agent의 추천안 |
| required_output | 받아야 하는 산출물 |
| linked_artifact_ids | 관련 문서/견적/제안서 |
| linked_approval_id | 관련 승인 Gate |
| due_at | 완료 희망 시간 |
| status | 현재 상태 |

## 표준 Handoff Template

```markdown
# Handoff Request

From: <Blue|Red|Orange|Gray|Teal>
To: <Blue|Red|Orange|Gray|Teal>
Project: <project name>
Type: <review|decision|clarification|risk_check|ux_check|evidence_check>
Priority: <low|medium|high|critical>

## Context
<현재 업무 상황>

## Decision Needed
<상대 Agent가 결정해야 하는 것>

## Constraints
<기술/고객/보안/일정/비용/규정 제약>

## Suggested Answer
<요청 Agent의 추천 가정>

## Required Output
<상대 Agent가 제공해야 하는 결과>

## Linked Artifacts
- <artifact id or title>

## Completion Criteria
- <완료 기준>
```

## 예시: Blue → Red

```markdown
# Handoff Request

From: Blue
To: Red
Project: SANGFOR HCI Renewal - Customer A
Type: risk_check
Priority: high

## Context
고객의 기존 VMware 환경을 SANGFOR HCI로 전환하는 제안서 초안이 작성되었다.

## Decision Needed
해당 전환안이 보안, 운영, 롤백 관점에서 승인 가능한지 검토가 필요하다.

## Constraints
- 고객 업무 중단 허용 시간은 4시간 이내
- 기존 백업 정책은 변경 불가
- PoC 없이 바로 구축 요청 가능성이 있음

## Suggested Answer
PoC 없이 production migration을 승인하지 않는다. 최소 rollback plan과 pilot migration이 필요하다.

## Required Output
- 주요 리스크
- 필수 보완 항목
- 승인 가능 조건
- Commercial/Delivery Gate 반영 여부
```

## Handoff 금지 패턴

```text
1. "검토해주세요"만 적은 카드
2. 결정 필요사항이 없는 카드
3. linked artifact가 없는 카드
4. 책임 회피성 handoff
5. 같은 내용을 여러 Agent에게 동시에 무분별하게 보내는 카드
```

## 완료 기준

Handoff는 다음 중 하나로 완료된다.

```text
- resolved: 필요한 판단과 산출물이 제공됨
- rejected: 요청이 해당 Color Agent 책임이 아님
- changes_requested: 입력 정보 부족
- escalated: 사람 승인자 또는 CEO로 escalation
```
