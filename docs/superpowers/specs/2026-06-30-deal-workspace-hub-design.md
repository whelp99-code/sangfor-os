# Deal Workspace Hub — Design Spec (v2, red-team hardened)

> Status: Draft for review · Date: 2026-06-30 · Branch: `feat-project-hub-phase3`
> Author: 박정민 + Claude · v2 incorporates a 4-angle adversarial red-team
> (data-model / domain / scope / architecture).

## 0. Why this document exists

This web app drifted for weeks. Root cause: **the target was never externalized** —
40 sidebar items, 14 doc domains, no single spine. This spec fixes the target. A
change that does not serve the one core flow below is out of scope. v2 adds the
guardrails (§11) that v1 lacked, so "out of scope" is enforced in code, not just intent.

## 1. The one core flow (the "heart")

A **deal workspace** where the partner *does the work* of moving one deal through a
standard pursuit-to-delivery pipeline, **human-led, AI assists from the side**
(Salesforce Lightning / Oracle CX layout, validated visually as "가깝다/좋네").
Not a status tracker — a workspace where each stage produces its deliverable.

## 2. Pipeline = TWO orthogonal axes (red-team C1)

v1's single linear 6-stage path could not represent a lost / dead / skipped deal —
fatal, since 65–80% of channel deals are lost and the loss reason is the highest-value
future-AI signal. **Stage and status are separate axes:**

- **Stage** (how far it reached): ①제안 → ②PoC → ③결과제출 → ④선정·입찰 → ⑤수주 → ⑥딜리버리
- **Status** (is it alive): `OPEN · WON · LOST · ON_HOLD · DISQUALIFIED` + `lostReason`
  (price / competing-partner / competing-vendor / no-budget / no-decision / timing)

**Deal type drives a variable path** (red-team H1): `dealType = NEW_BUILD | RENEWAL |
UPSELL | RESELL_SIMPLE`. Renewals/simple resells skip ②③④ — stages are **skippable
and recorded as events**, never force-passed. "단계 완료" is advisory, not a hard gate;
skipped stages capture a reason (feeds the AI signal).

| # | Stage | Standard deliverables | Exit (buyer action) |
|---|---|---|---|
| ① | 제안 | Deal Reg(총판 대행) · 자격검증 · 제안서 | 딜등록 승인 + EB 식별 + 제안서 확인 + 평가기준 합의 |
| ② | PoC | 평가계획서 · 측정가능 성공기준 · MAP · 이해관계자 매핑 | 성공기준 크로스펑셔널 사인오프 |
| ③ | 결과제출 | 정량 결과 · ROI(POV) · 경영진 readout | 성공기준 충족 입증 + 고객 검증 인정 |
| ④ | 선정·입찰 | RFP/입찰 · SPR · 경쟁 포지셔닝 | 벤더 선정 + 법무·구매 경로 + 가격 합의 |
| ⑤ | 수주 | SOW/계약 · 마일스톤 결제 · 핸드오프 | SOW 서명 + PO 수령 + 딜리버리팀 인수 |
| ⑥ | 딜리버리 | 킥오프→설계→구축→UAT→Go-Live→핸드오버 | Phase Sign-off + 이슈 baseline + 지식 이관 |

## 3. Channel model (red-team C2, H3, H4)

Chain: `Sangfor ─▸ 총판(Distributor) ─▸ 나(Platinum) ─▸ 고객`.

- **Deal Registration is a GATE, not a timer.** `regStatus = NOT_SUBMITTED | SUBMITTED |
  APPROVED | REJECTED | EXPIRED | CONTESTED`. REJECTED/EXPIRED/CONTESTED render as **red
  risk states** (that's where the operator must act). Includes a renewal action + conflict note.
- 총판이 대행 등록. 파트너는 정보 제공 → 상태 추적.
- **SPR** 나→총판→Sangfor. **Distributor is mutable with history** (registering ≠ fulfilling).
- **Margin has two components**: `frontMarginPct` (this deal) + `expectedRebate` (back-end
  rebate/MDF, may be a note). Showing only front margin under-reports the real economics.

## 4. Three screens

1. **딜 목록 (table)** — entry, route **`/deals`** (NOT `/projects` — see §5). Columns:
   Deal Code(PRJ-####), 딜/고객사, 총판, 제품군, 단계(mini)+상태, 공급가, 마진%, 딜등록, 담당, 마감.
   Stage filter, totals (labeled: 진행중 N건 · 가중 예상마진), `+ 새 딜`. Inline cell edit.
2. **딜 작업화면** — Highlights(채널 체인 + 딜등록 상태 배지) → Path(stage+status) → 단계 가이드
   (advisory) → 작업 탭(lazy-loaded per stage) + 우측 AI 레일.
3. **딜 상세** — sections, **inline-editable (CRUD)** but **derived fields read-only**
   (margin/score/probability are computed, never free-typed — red-team M2/H4). Default view
   = "essential ~12" fields; the rest behind 전체 편집/더보기 (red-team M1).

**AI rail = one concrete assist per stage** (red-team M3), else hide the rail for that stage:
①제안서 초안 · ②PoC 계획 초안 · ③ROI표(측정값→표) · ④SPR 요청 초안 · ⑤SOW 뼈대 · ⑥핸드오버 문서.
"유사 사례" only if grounded in the partner's own history; otherwise cut.

## 5. Data model — REUSE existing, resolve the FOUR-way collision (red-team CRITICAL 1, 2)

There are **four** things called/used as "project": `Project` (AI tenant), `Opportunity`
(deal), `Engagement` (=`delivery_projects`, **what `/projects` shows today**), `FinanceProject`
(=`finance_projects`). Resolutions:

- **The deal aggregate = `Opportunity`** (its `id` is the technical spine everything hangs off).
  Add `code` (PRJ-YYYY-NNNN, the user-facing "Project ID"), `ownerId`, `dealStatus`,
  `lostReason`, `dealType`, `distributorId`.
- **Route + label (DECIDED = option C, sequenced convergence):** the new deal list ships at
  **`/deals`** (label "딜") in Slice 1 so nothing breaks; `/projects` stays the Engagement
  delivery hub for now. **Later (Slice 5)** the Engagement hub is absorbed into the deal's
  ⑥딜리버리 tab, freeing `/projects` — at which point the deal home **reclaims `/projects` and
  the label "프로젝트"** (the user's mental model: 프로젝트 = the whole deal lifecycle = Opportunity).
  This gets safety now + the user's language at convergence, without an either/or.
- **`Opportunity.projectId` is a non-nullable FK to the AI tenant `Project`.** New-deal
  creation MUST resolve a tenant id — transitionally `MOCK_PROJECTS[0].id` / session context.
  Documented as a named assumption, not discovered at runtime.
- **Do NOT remap the `OpportunityStage` enum** (red-team: breaks CFO forecast weights +
  corrupts `OpportunityStageEvent` history). Keep the 7 values; add a **frontend label-mapping
  layer** to present the 6 stages. Any real enum change is a separate, late, explicitly-mapped
  migration — out of MVP.

| User concept | Existing model | Action |
|---|---|---|
| Deal (spine) | `Opportunity` | Adopt. Add code/ownerId/dealStatus/lostReason/dealType/distributorId. |
| 단계 Path + 이력 | `OpportunityStage` + `OpportunityStageEvent` | Keep enum; label-map to 6. StageEvent = **the AI training signal** (not AuditLog). |
| 자격검증 | `DealQualification` (BANT) | **Keep BANT** + add `economicBuyer`,`champion` (structured refs). NOT full MEDDPICC (red-team H5/D1). |
| PoC ②③ | `PocProject`+`PocResultReport` | Reuse — but `opportunityId` is nullable w/ deferred backfill: **backfill migration is a prerequisite** before surfacing (red-team F5). |
| 딜리버리 ⑥ | `Engagement` (FK `opportunityId` `@unique`) | Reuse. Relax `@unique`→`@@unique([opportunityId,phase])` for multi-phase (red-team H3). |
| 가격 ④⑤ | `Quote`/`QuoteLineItem` | Reuse; margins **DB-generated/read-only** + add `version` optimistic lock. |
| 총판 | `Partner.partnerType` | Constrain to enum (`DISTRIBUTOR`/`RESELLER`/`VENDOR`); `Opportunity.distributorId` FK. |
| Deal Registration | — (none) | **New `DealRegistration` model** (regStatus, number, protectionExpiresAt, sprStatus). Indexed for D-day query. |

## 6. Service boundary (red-team F6 — avoid god-loader)

`OpportunityService.getWorkspaceSummary(id)` → header only (stage, status, amount, customer,
channel, deal-reg). Stage detail loads **lazily per tab** (`PocService.getByOpportunityId`,
`QuoteService.getByOpportunityId`, `EngagementService.…`). Router→service→repository; no
business logic in route handlers. No single 10–15-query loader.

## 7. Future phase — seams only, do NOT build (red-team F7)

- **Owner seam**: `Opportunity.ownerId` → `User.id` now (real FK), commented for a future
  `Actor` union when AI ownership ships. Not a bare string.
- **Training signal**: designate `OpportunityStageEvent` (already written on every stage move)
  as the structured learning corpus. State it is load-bearing infra, not incidental logging.

## 8. Slices — brutally minimal (red-team CRITICAL/scope)

v1's "MVP" was 4 features bundled = the exact drift pattern. Re-cut:

- **Slice 1 (DoD: one checkpoint):** "`/deals` 목록에 PRJ-code 붙은 실제 Opportunity가 보인다."
  = `Opportunity.code` migration (sequence + `@@unique`) + `/deals` table (real data, columns,
  inline edit) + label-mapped stage/status pills. **No detail screen, no Path shell, no MEDDPICC,
  no new model.** `/projects` (Engagement) untouched. 총판 column = read existing `partnerId`
  or omit until Slice 2.
- **Slice 2:** 딜 상세 (sections, inline CRUD, read-only derived fields) + `dealStatus`/`lostReason`/
  `dealType` + BANT + EB/Champion. Lazy per-tab loaders.
- **Slice 3:** Path + 단계 가이드 (advisory) on the workspace; StageEvent writes.
- **Slice 4:** `DealRegistration` model + channel badges + SPR. Distributor enum.
- **Slice 5+:** wire each stage tab to existing PocProject/Engagement/Quote screens, one at a
  time. **Absorb** the Phase-3 AI domain hub (today's `/projects` Engagement hub) into the
  ⑥딜리버리 tab (red-team: avoid orphaning). Once `/projects` is free, **reclaim it as the deal
  home and relabel "프로젝트"**, merging `/deals` into it (convergence per §5 decision C).

## 9. Open decisions (resolve at the stated slice)

- **D-route/label — RESOLVED (option C):** Slice 1 deal list at `/deals` (label "딜");
  Slice 5 absorbs the Engagement hub into ⑥딜리버리 and reclaims `/projects` as the deal home
  relabeled "프로젝트". Safe start, converges to the user's language. No longer open.
- **D-enum (blocking Slice 3):** keep 7-value enum + label map; defer any real remap. Mapping
  for a future remap: LEAD/QUALIFIED/PROPOSAL→①, POC→②, NEGOTIATION→④, WON→⑤, LOST→status.
- **D-tenant (blocking Slice 1):** `Opportunity.projectId` filled from `MOCK_PROJECTS[0]`/session.
- **D-qual (blocking Slice 2):** BANT + EB + Champion (recommended), not full MEDDPICC.
- **D-code (Slice 1):** PRJ-YYYY-NNNN via Postgres `SEQUENCE` (per-year via counter row + row lock).
- **D-owner-filter (Slice 1/2):** does `ownerId` imply row-level "내 딜만 보기"? If yes it spreads
  into every `listOpportunities` query — decide before adding the column.

## 10. Non-goals

Rebuilding finance/knowledge/agent-orchestration here. AI autonomously owning deals.
Non-Sangfor vendors. Reseller (3rd tier). True parallel stages (model doesn't preclude, doesn't build).

## 11. Anti-drift guardrails (red-team F4, F11 — the part v1 missed)

1. **`NavItem.tier` (`primary | more | system`)** added to `portal-config.ts`; all 33 items
   tagged. Primary = 홈/딜/회사 only. "더보기" becomes a code fact, not a doc aspiration.
   Comment: routes tier≠primary are **frozen** — no feature work without spec approval.
2. **Per-slice Definition of Done** = the checkpoint sentence above; nothing merges without it.
3. **Slice-1 PR limits:** ≤1 new migration, ≤2 new screens, **zero regression to `/opportunities`
   and `/projects`**, zero hardcoded mock data in the new pages.
4. AI assist lives only in the right rail (enforced in the workspace layout component).
