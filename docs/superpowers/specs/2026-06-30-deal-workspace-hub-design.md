# Deal Workspace Hub — Design Spec

> Status: Draft for review · Date: 2026-06-30 · Branch: `feat-project-hub-phase3`
> Author: 박정민 + Claude (brainstorming session)

## 0. Why this document exists

This web app drifted for weeks. Root cause: **the target was never externalized** —
40 sidebar items, 14 doc domains, no single spine. This spec fixes the target so
every future task is measured against it. If a change does not serve the one core
flow below, it is out of scope.

## 1. The one core flow (the "heart")

A **deal (Opportunity) workspace** where the partner *does the work* of moving one
deal through a standard 6-stage pursuit-to-delivery pipeline, **human-led, AI assists
from the side** (Salesforce Lightning / Oracle CX layout pattern, validated visually).

Not a status tracker. A **workspace**: each stage is where the deliverable is produced
(proposal written, PoC run, results compiled), not a checkbox that is flipped.

## 2. The standard 6-stage pipeline

Buyer-behavior-based stages, each with standard deliverables + exit criteria
(MEDDPICC overlay for qualification; standard POC evaluation-plan; standard
SOW→UAT→Go-Live→Handover delivery gates).

| # | Stage (KO) | Standard deliverables | Exit criteria (buyer action) |
|---|---|---|---|
| ① | 제안 | Deal Registration(총판 대행) · MEDDPICC 자격검증 · 제안서 | 딜 등록 승인 + 경제적 의사결정자 식별 + 제안서 확인 + 평가기준 합의 |
| ② | PoC | 평가계획서(use case↔business) · 측정가능 성공기준 · MAP(30–90일) · 이해관계자 매핑 | 성공기준 크로스펑셔널 사인오프 |
| ③ | 결과제출 | 정량 결과보고 · 비즈니스 가치/ROI(POV) · 경영진 readout | 합의 성공기준 충족 입증 + 고객 검증 인정 |
| ④ | 선정·입찰 | RFP/입찰 응답 · SPR(특별가) · 경쟁 포지셔닝 · Paper Process | 고객 벤더 선정 + 법무·구매 경로 확인 + 가격 합의 |
| ⑤ | 수주 | SOW/계약 체결 · 마일스톤 결제 · 영업→딜리버리 핸드오프 | SOW 서명 + PO 수령 + 딜리버리팀 인수 |
| ⑥ | 딜리버리 | 킥오프→설계(FRD)→구축·통합→UAT(고객주도·사인오프)→Go-Live(Go/No-Go)→핸드오버 | 단계별 Phase Sign-off + 이슈 baseline 복귀 + 지식 이관 |

## 3. Channel model (Sangfor Platinum partner)

Fixed 3-party chain (reseller dropped per partner reality):

```
Sangfor(벤더) ─▸ 총판(Distributor) ─▸ 나(Platinum Partner) ─▸ 고객(End Customer)
```

- **Deal Registration**: 총판이 대행 등록. 파트너는 정보 제공 → 보호상태(D-day) 추적.
- **Special Pricing (SPR)**: 나 → 총판 → Sangfor, 등록 딜 기반 가격 보호.
- **PO 체인**: 고객 → 나 → 총판 → Sangfor. 마진 = 등록딜 + Platinum 티어.

## 4. Three screens

1. **프로젝트 전체 (table)** — entry. Salesforce/Oracle list view. Columns: Project ID,
   딜/고객사, 총판, 제품군, 단계(mini path), 공급가, 마진%, 딜등록, 담당, 마감.
   Filters by stage, totals, `+ 새 프로젝트` (generates ID). Inline-editable cells.
2. **딜 작업화면** — Highlights(채널 체인 + 딜등록 배지) → Path(6-stage) → 단계 가이드
   (표준 산출물 체크 + 통과기준) → 작업 탭(do the work) + 우측 AI 레일(제안만).
3. **딜 상세** — 5 sections (딜 정보 / 채널·등록 / 고객·의사결정 / MEDDPICC / 일정),
   **every field inline-editable (CRUD), + 전체 편집 모드, 실제 저장.**

Visual: Salesforce Lightning look — validated "가깝다/좋네" in mockup
(`.superpowers/brainstorm/.../table-projects.html`, `deal-detail-v2.html`, `deal-workspace.html`).

## 5. Data model — REUSE, do not reinvent

**Critical:** the "Project ID spine" the user wants already exists as the
`Opportunity` aggregate. Building a NEW "Project" entity would create a THIRD
overlapping concept (sprawl). Naming collision warning: `Project` is already the
**AI/dev workspace tenant** (`Opportunity.projectId` points to it) — it is NOT the deal.

| User concept | Existing model | Action |
|---|---|---|
| Project/Deal (spine) | `Opportunity` (`id` = the FK everything hangs off) | **Adopt as aggregate root.** Add human-readable `code` (PRJ-2026-####) + `ownerId`. |
| 단계 Path | `OpportunityStage` enum + `OpportunityStageEvent` (history) | **Remap enum to the canonical 6 stages**; keep stage-event log. |
| 자격검증 | `DealQualification` (BANT: budget/authority/need/timeline) | **DECISION NEEDED:** extend to MEDDPICC or keep BANT + add MEDDPICC fields. |
| PoC (②③) | `PocProject` + `PocResultReport` (already FK `opportunityId`) | Reuse. Surface in stage ②③ tabs. |
| 딜리버리 (⑥) | `Engagement` (= `delivery_projects`, FK `opportunityId` unique) | Reuse. Surface in stage ⑥. |
| 가격 (④⑤) | `Quote` / `QuoteLineItem` / `QuoteServiceLineItem` | Reuse in stage ④⑤. |
| 벤더 요청 | `VendorRequest` (FK `opportunityId`) | Reuse for Sangfor/총판 interactions. |

**Missing — must add (small, additive migrations):**
- `Opportunity.code` (human-readable PRJ-YYYY-NNNN, the user-facing "Project ID").
- `Opportunity.ownerId` → polymorphic-capable owner. **Seam #1** for future AI owner.
- **Channel/Deal-Registration entity**: 총판(distributor) ref, deal-reg number/status/
  protection-expiry, SPR status, partner tier margin. (No existing model covers this.)
- Distributor as a party (extend `Partner` with a `kind` = DISTRIBUTOR vs RESELLER, or new field).

## 6. Future phase (seams only now, do NOT build)

> "추후에 담당을 AI에게 부여 — 내가 진행하는 걸 많이 학습한 후에."

- **Seam #1 — owner = human OR AI.** `Opportunity.ownerId` references a unified
  actor (user or agent), so AI can later own a deal/stage without a rewrite.
- **Seam #2 — every action logged as structured events** (reuse existing
  `AuditLog` / `AgentDecisionLog` / `OutboxEvent`) → becomes AI training signal.

No AI-ownership logic is built in this scope. Seams must merely not preclude it.

## 7. The other 35 menus

Hidden under "더보기", **not deleted**. CFO(9), 지식/AI, 시스템 stay reachable but
off the primary surface. Primary nav = 홈 / 프로젝트(table) / 딜 / 회사.

## 8. MVP first slice (build this first — resist building all of §2 at once)

**Spine first, stage internals later:**
1. `Opportunity.code` + `ownerId` migrations; remap stage enum to 6 stages.
2. **프로젝트 테이블** (screen 1) reading real Opportunities, inline cell edit, `+ 새 프로젝트` issues a code.
3. **딜 상세** (screen 3) — 5 sections, inline edit (CRUD), wired to Opportunity + relations.
4. **6-stage Path** shell on the deal workspace (screen 2 header), reading `stage` + writing `OpportunityStageEvent`.
5. Stage-tab internals (제안서 editor, PoC, 결과, 입찰, 딜리버리) reuse existing
   PocProject/Engagement/Quote screens — wired in **one stage at a time** after the spine works.

Channel/Deal-Reg entity + 단계 가이드 content land in slice 2.

## 9. Open decisions (resolve before/at planning)

- D1: BANT (existing) vs MEDDPICC (proposed) — extend or replace?
- D2: `Opportunity.code` format + generation (PRJ-YYYY-NNNN, per-year sequence?).
- D3: Distributor modeled as `Partner.kind=DISTRIBUTOR` vs a dedicated model.
- D4: Stage enum remap — migration for existing Opportunity rows to the 6-stage set.
- D5: Does "프로젝트" in the UI label map to Opportunity (recommended) — and how to
  avoid confusing it with the existing `Project` tenant in code/naming?

## 10. Non-goals

Rebuilding finance(CFO), knowledge base, agent-orchestration as part of this. AI
autonomously owning deals. Multi-vendor (non-Sangfor) channel. Reseller (3rd tier).
