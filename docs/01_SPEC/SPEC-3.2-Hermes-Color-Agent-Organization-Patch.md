# SPEC-3.2-Hermes-Color-Agent-Organization-Patch

## 목적

V3.2는 V3.1의 Agentic Company OS / SANGFOR Partner OS 구조를 유지하면서, Hermes Agent 협업 모델을 정식으로 추가한다.

핵심 변경점은 다음이다.

```text
V3.1: 역할 Persona + Workflow + Approval + Artifact 중심
V3.2: 위 구조에 Color Agent Layer를 추가
```

Color Agent는 새로운 직무가 아니다.  
Color Agent는 **검토 관점, 책임 경계, Kanban handoff 표준, 품질 게이트 책임자**다.

## 핵심 원칙

```text
Color is responsibility.
Project is context.
Kanban is the official handoff channel.
Persona executes business work.
Color Agent reviews, routes, records, and guards quality.
```

한국어 원칙:

```text
색은 책임 영역이다.
프로젝트는 맥락이다.
Kanban은 공식 책임 이관 통로다.
업무 Persona는 실제 업무를 수행한다.
Color Agent는 관점별 검토, 라우팅, 기록, 품질 게이트를 담당한다.
```

## Color Agent Set

| Color | 이름 | 핵심 책임 |
|---|---|---|
| Blue | Technical Direction Agent | 기술 방향, 구현 지휘, 아키텍처 일관성, 솔루션 sizing |
| Red | Risk & Safety Agent | 보안, 회귀, 승인 우회, 상업/운영/데이터 리스크 |
| Orange | Product & Business Value Agent | 고객 가치, 매출 적합성, ROI, deal qualification, renewal/upsell |
| Gray | Documentation & Evidence Agent | 문서, ADR, 결정 기록, 근거 추적, audit-ready evidence |
| Teal | UX & Visibility Agent | UI/UX, 대시보드, 가시성, 상태 표현, 사용성 |

선택 확장:

| Color | 이름 | 조건 |
|---|---|---|
| Purple | Operations Runtime Agent | 운영 복잡도가 커질 때 추가. 배포, 장애, 비용, 관측성 담당 |

MVP에서는 Purple을 별도 Agent로 만들지 않고 Blue/Red/Operator Runbook에 포함한다.

## 기존 Persona와의 관계

업무 Persona와 Color Agent는 충돌하지 않는다.

| 구분 | 설명 |
|---|---|
| Business Persona | Sales Manager, Presales Engineer, Solution Architect, Finance Manager 등 실제 업무 수행자 |
| Color Agent | 업무 결과를 관점별로 검토하고, 책임 밖 판단을 Kanban으로 이관하는 협업 레이어 |

예:

```text
Presales Engineer가 Solution Fit Matrix 작성
→ Blue가 기술 적합성 검토
→ Red가 보안/운영 리스크 검토
→ Orange가 고객 가치와 수주 가능성 검토
→ Gray가 근거와 문서 버전 정리
```

## SANGFOR Partner OS 매핑

| Color | SANGFOR Pack 적용 |
|---|---|
| Blue | Solution Architecture, BoM, Product Sizing, Delivery Readiness |
| Red | Commercial Risk, Security Risk, SLA Risk, Approval Bypass Prevention |
| Orange | Deal Qualification, Customer Value, Revenue Forecast, Renewal/Upsell |
| Gray | Proposal Version, Decision Log, Evidence Bundle, Customer History |
| Teal | Pipeline Dashboard, Approval Page, Operator Console, Admin Visibility |

## Kanban Handoff 원칙

Agent는 자기 책임 밖 판단을 직접 결정하지 않는다.  
다음 조건이면 Kanban handoff card를 생성한다.

```text
1. 다른 색의 책임 영역에 속한 판단이 필요하다.
2. 결정 근거가 부족하다.
3. 고객/벤더/재무/보안에 영향을 줄 수 있다.
4. 승인 Gate 이전에 누락 검토가 필요하다.
5. 사용자가 이해할 수 있는 표현으로 바꿔야 한다.
```

## Risk-based Routing

모든 업무에 5색을 모두 붙이지 않는다.  
V3.2는 업무 위험도에 따라 Color Agent 참여를 동적으로 결정한다.

| 위험도 | 참여 Color |
|---|---|
| Low | Blue 또는 Orange 단독 |
| Medium | Blue + Gray |
| High | Blue + Red + Orange |
| Customer-facing | Gray + Teal 필수 |
| Commercially sensitive | Red + Orange + Gray 필수 |
| Restricted data | Red + Gray 필수 |
| UI/Dashboard change | Teal 필수 |
| Architecture/Integration change | Blue + Red 필수 |

## Acceptance Criteria

V3.2는 다음을 만족해야 한다.

```text
1. Color role definition 문서가 존재한다.
2. Kanban handoff template이 존재한다.
3. Color routing rule이 존재한다.
4. SANGFOR Pack persona와 Color Agent 매핑이 존재한다.
5. DB skeleton에 color agent profile과 handoff table이 추가된다.
6. API skeleton에 color agent 및 handoff endpoint가 추가된다.
7. Seed JSON에 기본 5색 role registry가 추가된다.
8. Coverage report에서 V3.2 추가 항목이 100% 반영된다.
```

## 구현 범위

V3.2는 실행 가능한 skeleton을 제공하지만, 완성 구현은 아니다.  
외주 개발팀은 다음을 구현해야 한다.

```text
- color agent registry persistence
- kanban handoff state machine
- assignment-based routing
- notification integration
- dashboard widget
- audit log integration
- permission checks
```
