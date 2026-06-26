---
slug: phase1-integration
status: awaiting-approval
intent: clear
pending-action: 승인 후 실행
approach: Phase 1 Business Logic (M10/M13/M14/M15) + key asset absorption
---

# Phase 1 — Business Logic + Asset Absorption

## TL;DR

**What you'll get:** sangfor-os에 Deal Qualification (BANT), Commercial Gate (마진/할인 규칙), Delivery→Asset→Subscription 자동화, Renewal 알림 완성. AIOS v1과 AIOSv2_integration 모듈 이식으로 시간 단축.

**Effort:** Medium (~2주) | **Risk:** Medium

## Scope

### Must have
1. QuoteStatus / OpportunityStage enum → Prisma schema
2. Deal Qualification (M10): BANT 점수화 → OpportunityStageEvent 기록
3. Commercial Gate (M13): margin/discount 자동 규칙 → ApprovalRequest 생성
4. Delivery→Asset→Subscription (M14/M15): Delivery 완료 시 auto-pipeline
5. Renewal 알림 (M15): 90/30/14일 전 NotificationEvent
6. Quote Builder 고도화: calculateQuote + ProductSku 가격 조회
7. AIOS v1 opportunity-stage/center 이식
8. AIOSv2_integration approval-policy/persona-gate 이식
9. API endpoints: qualify, calculate, delivery/complete, renewals

### Must NOT have
- AIOS v1 전체 이식, vibe-coding-os, aios-jarvis, AI-Engine
- UI 변경, 운영 DB 변경, 외부 API 호출

## Todos (10개, 4 Waves)

### Wave 1 — Foundation (Tasks 1-3)
1. Prisma enum: QuoteStatus + OpportunityStage + migration
2. AIOS v1 opportunity-stage + center 이식
3. Deal Qualification (M10): BANT 점수화

### Wave 2 — Business Gate (Tasks 4-6)
4. AIOSv2_integration approval-policy + persona gate 이식
5. Commercial Gate (M13): 자동 규칙 엔진
6. Quote Builder 고도화

### Wave 3 — Asset Lifecycle (Tasks 7-8)
7. Delivery→Asset→Subscription (M14) 자동화
8. Renewal 알림 (M15) 자동화

### Wave 4 — API + 검증 (Tasks 9-10)
9. Phase 1 API endpoints 통합
10. 최종 검증 (typecheck + test + evidence)

## Commit strategy
1. `feat(db): add QuoteStatus and OpportunityStage enums`
2. `feat(business): absorb AIOS v1 opportunity-stage and center`
3. `feat(business): deal qualification with BANT scoring`
4. `feat(business): absorb AIOSv2 approval-policy and persona gate`
5. `feat(business): commercial gate with auto approval rules`
6. `feat(api): wire calculateQuote into createQuote`
7. `feat(business): delivery-to-asset-subscription pipeline`
8. `feat(business): renewal notification automation`
9. `feat(api): phase 1 endpoints`
10. `test: phase 1 integration verification`

## Success criteria
- M10: BANT 점수 → OpportunityStageEvent 기록
- M13: 마진/할인 규칙 → ApprovalRequest 자동 생성
- M14: Delivery 완료 → Asset → License → Subscription
- M15: 만료 90/30/14일 전 NotificationEvent
- pnpm typecheck + pnpm test 통과
- 모든 코드 250 LOC ceiling
