# Color Agent Operations Runbook

## Handoff가 멈췄을 때

### 증상

```text
kanban_handoff_cards.status = submitted 또는 in_review 상태가 SLA 이상 유지
```

### 확인

```text
1. to_color 담당 Agent 존재 여부
2. project_color_agents.status
3. linked artifact 접근 권한
4. required_output 누락 여부
5. notification delivery 실패 여부
```

### 복구

```text
1. 담당 Color Agent 재배정
2. due_at 연장 또는 escalation
3. 누락 context 보완 요청
4. critical이면 human owner에게 알림
```

### 금지

```text
DB에서 status를 직접 resolved로 변경 금지
linked artifact 없이 resolved 금지
audit log 없이 handoff 삭제 금지
```

## Color Review 병목

### 주요 지표

```text
color_handoff_age_p95
color_handoff_reopen_rate
color_review_pending_total
color_review_sla_breach_total
color_review_by_color_total
```

### 병목 기준

```text
Blue 병목: 기술 검토 과다
Red 병목: 리스크 검토 과다 또는 과도한 high-risk routing
Orange 병목: business decision 누락
Gray 병목: 문서 근거 누락 과다
Teal 병목: UI/customer-facing 변경 집중
```

## 장애 대응

```text
1. Color Agent routing 실패 시 default route = Gray + human coordinator
2. linked artifact 접근 실패 시 card를 changes_requested로 전환
3. critical handoff notification 실패 시 email + dashboard alert
4. audit write 실패 시 handoff completion 차단
```
