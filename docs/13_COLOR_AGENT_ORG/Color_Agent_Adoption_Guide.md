# Color Agent Adoption Guide

## 목적

V3.1 시스템을 중단하지 않고 V3.2 Color Agent Layer를 단계적으로 도입한다.

## Phase 0 — 문서 도입

```text
1. Color Role Definitions를 팀에 공유
2. 기존 Persona와 Color Agent가 다르다는 점 교육
3. Kanban Handoff Template 적용
4. high-risk 업무에만 수동으로 Color review 태그 부여
```

## Phase 1 — DB/API Skeleton 적용

```text
1. color_agent_profiles seed 적용
2. project_color_agents 생성
3. kanban_handoff_cards 저장
4. handoff_events audit log 연동
5. dashboard에 Color Review Pending 위젯 추가
```

## Phase 2 — Workflow Routing 적용

```text
1. artifact_type별 routing rule 등록
2. quote/proposal/poc/support/renewal에 required_colors 자동 계산
3. approval gate 이전에 color review completion 체크
4. stale artifact 변경 시 필요한 Color만 재검토
```

## Phase 3 — Dashboard 적용

```text
1. User Home에 "내 Color Review 대기" 추가
2. Admin Dashboard에 Color별 병목 표시
3. Operator Console에 stuck handoff 표시
4. Audit 화면에 color review evidence 추가
```

## Phase 4 — 자동화

```text
1. AI Agent가 handoff draft 생성
2. 사람이 high-risk handoff 승인
3. 반복 handoff 패턴을 routing rule에 반영
4. Color Guild별 품질 지표 집계
```

## 도입 시 금지 사항

```text
1. 모든 업무에 5색 review 강제 금지
2. Color Agent를 기존 업무 Persona의 대체물로 오해 금지
3. Gray에게 모든 문서 작성을 몰아주기 금지
4. Red를 모든 업무의 병목으로 만들기 금지
5. Kanban 외부 메신저로 결정 완료 금지
```

## 성공 지표

```text
- handoff 재작업률 감소
- 승인 반려 사유 명확도 증가
- artifact 근거 누락률 감소
- proposal first-pass approval 증가
- quote approval cycle time 유지 또는 감소
- dashboard에서 담당자/다음 action 파악 시간 감소
```
