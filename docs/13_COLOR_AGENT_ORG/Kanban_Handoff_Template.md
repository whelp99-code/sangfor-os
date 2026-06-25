# Kanban Handoff Template

아래 템플릿은 모든 Color Agent handoff card에 사용한다.

```markdown
# Handoff Request

From: <Blue|Red|Orange|Gray|Teal>
To: <Blue|Red|Orange|Gray|Teal>
Project: <project name>
Workflow Run: <workflow_run_id>
Linked Approval: <approval_id or none>
Priority: <low|medium|high|critical>
Type: <review|decision|clarification|risk_check|ux_check|evidence_check>

## Context
<현재 상황을 5문장 이내로 설명>

## Decision Needed
<상대 Agent가 판단해야 하는 질문 1~3개>

## Constraints
- <제약 1>
- <제약 2>
- <제약 3>

## Suggested Answer
<요청 Agent의 추천 가정. 없으면 "No recommendation">

## Required Output
- <필요 산출물 1>
- <필요 산출물 2>

## Linked Artifacts
- <artifact title/id/version>

## Completion Criteria
- <완료 기준 1>
- <완료 기준 2>
```

## 작성 규칙

1. Context는 짧게 쓴다.
2. Decision Needed는 반드시 질문형으로 쓴다.
3. Suggested Answer는 있어야 한다. 판단을 돕기 위해 추천 가정을 제공한다.
4. Linked Artifact 없이 high priority handoff를 만들 수 없다.
5. Critical handoff는 audit log와 notification을 반드시 생성한다.

## 좋은 예

```markdown
From: Orange
To: Blue
Project: Customer B SASE Opportunity
Priority: high
Type: decision

## Context
고객은 원격근무 보안과 웹 접속 통제를 개선하고자 한다. 예산은 확인되었고 경쟁사는 Fortinet이다.

## Decision Needed
SANGFOR SASE와 SWG 조합이 고객 요구에 기술적으로 적합한가?

## Constraints
- 사용자 수 800명
- 구축 희망 일정 30일 이내
- 기존 방화벽 교체는 원하지 않음

## Suggested Answer
SASE 중심 제안이 적합해 보이나 기존 방화벽 유지 조건 때문에 연동 검토가 필요하다.

## Required Output
- 제품 조합
- 추가 discovery 질문
- 기술 리스크
- PoC 필요 여부
```
