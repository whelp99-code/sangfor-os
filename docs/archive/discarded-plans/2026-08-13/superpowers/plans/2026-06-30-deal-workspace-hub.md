# Deal Workspace Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. One agent per Task; review + gate between tasks. Steps use `- [ ]`.

**Goal:** Turn the partner's drifting app into one focused deal pursuit-to-delivery workspace, by aligning the existing `deals/*` code to the approved mockups + red-team-hardened spec, slice by slice.

**Architecture:** Reuse the `Opportunity` aggregate as the spine (its `id` is the FK everything hangs off). Add a human-readable `code` (PRJ-YYYY-NNNN). Left-sidebar shell (shadcn `Sidebar` + `AppTopbar`). Deal list = table (default) + stage-Kanban toggle, at `/deals`. Detail = inline-editable sections, derived fields read-only. Stage × status are orthogonal axes. Channel chain (Sangfor→총판→나→고객) + Deal Registration gate. AI assist lives only in the right rail.

**Tech Stack:** Next.js (custom build — read `node_modules/next/dist/docs/` before writing Next code, per apps/web/AGENTS.md), React + TypeScript, Tailwind v4 + shadcn (semantic tokens, `style: base-nova`, lucide), `@tanstack/react-table` + `DataView`, Prisma (Postgres), vitest.

## Global Constraints (every task inherits these)

- **Mockups are the layout SSOT:** `docs/superpowers/specs/mockups/` (`_kit.md`, `00`–`16`, `01b`). Structure/regions/field-inventory are binding; color maps to shadcn tokens (`--primary`/`--card`/`--border`/`--muted-foreground`/`--destructive`), NEVER hardcode the mockup hex. Diff against the mockup after building.
- **Do NOT remap the `OpportunityStage` enum.** The 6 display stages (제안/PoC/결과제출/선정·입찰/수주/딜리버리) are a presentation layer over the 7 enum values (LEAD/QUALIFIED/PROPOSAL/POC/NEGOTIATION/WON/LOST). Remapping breaks the CFO forecast (hardcoded stage weights) and `OpportunityStageEvent` history.
- **Additive migrations only.** Run via `pnpm db:push:safe` (snapshots CFO first). Never drop a live enum value. New columns nullable or defaulted.
- **Derived fields are read-only** (margin, probability, current-stage) — never user-editable. Use `.fl.readonly` pattern.
- **Qualification = BANT + Economic Buyer + Champion.** NOT full MEDDPICC.
- **Deal list default = table**, with a 칸반 토글 (stage-Kanban, distinct from the regStatus board).
- **Route:** new surface ships at `/deals`; `/opportunities` stays untouched until Slice 6 convergence.
- **CFO/finance fully deferred** — do not add a finance tab; do not touch CFO. Preserve the Quote/Invoice/Engagement data seam.
- **Anti-drift gates:** each Task ends green (`pnpm -r typecheck` + its test). Each Slice ends with a gate: `pnpm -r typecheck && pnpm -r test && pnpm --filter @sangfor/web build` all green + a mockup-diff review. No slice starts before the prior slice's gate passes. PR limits per slice: ≤1 migration, keep `/opportunities` + `/projects` + CFO non-regressed.
- **NavItem.tier:** primary = 홈/딜/회사 (+연락처/파이프라인); everything else `tier:'more'` (frozen). AI assist only in the right rail (enforced in the workspace layout component).

---

## Slice 1 — Deal spine at `/deals` (table, Project ID)

**DoD (one checkpoint):** Navigating to `/deals` shows real `Opportunity` rows in a table whose first column is a PRJ-#### code, with the binding columns, table default + 칸반 toggle, inline cell edit; `/opportunities`, `/projects`, CFO unchanged.

### Task 1.1 — `Opportunity.code` migration + sequence
**Files:** Modify `packages/db/prisma/schema.prisma` (Opportunity model); Create `packages/db/prisma/migrations/<ts>_opportunity_code/migration.sql`.
**Interfaces:** Produces `Opportunity.code String? @unique @map("code")`.
- [ ] Add `code String? @unique @map("code")` to `Opportunity`.
- [ ] Write migration SQL: `CREATE SEQUENCE IF NOT EXISTS opp_code_seq;` + `ALTER TABLE opportunities ADD COLUMN code text;` + `CREATE UNIQUE INDEX opportunities_code_key ON opportunities(code);`
- [ ] Backfill existing rows: `UPDATE opportunities SET code = 'PRJ-2026-' || lpad(nextval('opp_code_seq')::text,4,'0') WHERE code IS NULL;`
- [ ] Run `pnpm db:push:safe` then `pnpm db:generate`. Verify `pnpm --filter @sangfor/db typecheck` green.
- [ ] Commit `feat(db): add Opportunity.code (PRJ-YYYY-NNNN) + sequence`.

### Task 1.2 — `generateDealCode()` in business layer (TDD)
**Files:** Create `packages/business/src/deal-code.ts`; Test `packages/business/src/deal-code.test.ts`.
**Interfaces:** Produces `formatDealCode(year:number, seq:number): string` → `PRJ-2026-0042`.
- [ ] Write failing test: `formatDealCode(2026, 42) === 'PRJ-2026-0042'`; `formatDealCode(2026, 7) === 'PRJ-2026-0007'`.
- [ ] Run `pnpm --filter @sangfor/business test -- deal-code` → FAIL.
- [ ] Implement `formatDealCode` (zero-pad 4). 
- [ ] Run test → PASS. Commit `feat(business): formatDealCode helper`.

### Task 1.3 — Deal-create service issues a code (TDD)
**Files:** Modify the opportunity create path in `packages/business/src/*` (the service used by `apps/web/src/app/api/opportunities/route.ts`); Test alongside.
**Interfaces:** Consumes `formatDealCode`; the create function returns an Opportunity with `code` populated via `nextval('opp_code_seq')`.
- [ ] Failing test: creating an opportunity yields a `code` matching `/^PRJ-\d{4}-\d{4}$/`.
- [ ] Implement: in create, `SELECT nextval('opp_code_seq')`, set `code = formatDealCode(currentYear, seq)`. (Year passed in, not `Date.now()` in pure code paths.)
- [ ] Test → PASS. Commit `feat(business): assign deal code on create`.

### Task 1.4 — Extend `Deal` type + list query
**Files:** Modify `apps/web/src/components/deals/types.ts`; the list loader feeding `deals-table.tsx`; `apps/web/src/app/api/opportunities/route.ts` (GET include `code` + relations).
**Interfaces:** Produces `Deal` with `code, productLine, distributorName, supplyAmount, marginPct, regStatus, ownerName, closeDate, nextAction, stage, dealStatus`.
- [ ] Extend `Deal` type with the fields above (nullable where not yet in schema — `distributorName`/`marginPct`/`regStatus` may be derived/placeholder until later slices; mark `// TODO(slice4)` where sourced later).
- [ ] List query selects `code`, `customer`, `partner`, `amount`, `stage`, `probability`, `closeDate`, `nextAction`.
- [ ] `pnpm -r typecheck` green. Commit.

### Task 1.5 — `deals-table.tsx` → binding columns (mockup 01)
**Files:** Modify `apps/web/src/components/deals/deals-table.tsx`, `stage-meta.ts`.
**Interfaces:** Columns in binding order from layout-contract §3: ☐ · **Project ID** (mono `text-primary` link → `/deals/[id]`) · 딜/고객사 · 총판 · 제품군 · 단계 (mini pips + label via `STAGE_LABELS` display-map) · 공급가 (num) · 마진% (num, **read-only/muted**) · 딜등록 (Badge) · 담당 · 마감 · 다음 액션 · ⋯.
- [ ] Add `STAGE_DISPLAY` map (enum→①–⑥ Korean) in `stage-meta.ts` + a `<StagePips>`/`<StatusPill>` helper (shadcn Badge; tokens: success/warning/destructive).
- [ ] Define the ColumnDefs to match mockup 01; margin column rendered muted (no edit). Project ID = mono primary link.
- [ ] Verify visually against `mockups/01-deal-list.html` (open it). `pnpm -r typecheck` green. Commit.

### Task 1.6 — `/deals` route + sidebar nav
**Files:** Create `apps/web/src/app/(portal)/deals/page.tsx` + `apps/web/src/app/(portal)/deals/[id]/page.tsx` (render existing `DealsWorkspace`/detail with `defaultView="table"`); Modify `apps/web/src/lib/portal-config.ts` (add `{title:"딜", href:"/deals", tier:"primary"}`; do NOT remove `/opportunities`).
**Interfaces:** Consumes `DealsWorkspace`.
- [ ] Read `node_modules/next/dist/docs/` routing notes (custom Next) before adding pages.
- [ ] Add `/deals` pages mounting the workspace, table default. Row/card links → `/deals/[id]`.
- [ ] Add `NavItem.tier` field to the `NavItem` type; tag 딜/회사/홈/연락처/파이프라인 as `primary`, others `more`.
- [ ] `pnpm --filter @sangfor/web build` green; manual: `/deals` renders, `/opportunities` still works. Commit.

### Task 1.7 — ViewSwitcher default table + kanban toggle
**Files:** Modify `apps/web/src/components/deals/deals-workspace.tsx` (default view), confirm `deals-board.tsx` columns = stages.
- [ ] Default `useCollectionView("table")`. Toggle to `deals-board.tsx` (stage columns). 
- [ ] Diff against `mockups/01-deal-list.html` (table+toggle) and `01b-deal-board.html`. Typecheck green. Commit.

**SLICE 1 GATE:** `pnpm -r typecheck && pnpm -r test && pnpm --filter @sangfor/web build` green; `/deals` matches mockup 01; `/opportunities`/`/projects`/CFO non-regressed.

---

## Slice 2 — Deal detail (inline CRUD, read-only derived, BANT, status)

**DoD:** `/deals/[id]` detail renders the 5 sections from mockup 03, every editable field saves; margin/probability/stage are read-only; qualification = BANT+EB+Champion; `dealStatus`+`lostReason`+`dealType` exist and display.

- **T2.1 (db):** additive migration — `Opportunity.dealStatus` enum (`OPEN/WON/LOST/ON_HOLD/DISQUALIFIED`, default OPEN), `lostReason String?`, `dealType String?` (default `NEW_BUILD`), `ownerId String?`. `db:push:safe`. (Owner = `User.id` FK now; comment future Actor union.)
- **T2.2 (db/business):** `DealQualification` — add `economicBuyerId String?`, `championId String?` (FK Contact); keep BANT scores; `weightedScore`/`passed` computed at read (do not expose as writable). Test.
- **T2.3 (web):** `deal-detail.tsx` + `deal-detail-section.tsx` + `inline-field.tsx` (shadcn Input/Select, optimistic save → `PATCH /api/opportunities/[id]`). Sections per mockup 03: 딜 정보 / 채널·딜등록 / 고객·의사결정 / 자격검증(BANT) / 일정.
- **T2.4 (web):** read-only treatment for 마진/확률/현재단계 (`.fl.readonly` equivalent — muted, no edit). Status pill + lostReason field.
- **T2.5 (api):** `PATCH /api/opportunities/[id]` validates editable fields only (reject writes to derived). Test (vitest) for the validation.
- **GATE:** typecheck+test+build; detail matches mockup 03.

## Slice 3 — Stage Path + status axis + guide

**DoD:** Workspace header shows the 6-stage Path (display-mapped) carrying stage AND status (lost/on-hold rendered); advancing a stage writes `OpportunityStageEvent`; the advisory stage-guide checklist shows per-stage standard deliverables.

- **T3.1 (web):** `deal-stage-path.tsx` — 6 cells display-mapped, status overlay (lost = red cap), current highlighted. From `mockups/02`.
- **T3.2 (web):** `deal-stage-guide.tsx` — advisory checklist + exit criteria per stage (content from design §2); "단계 완료" advisory (allow skip with reason → StageEvent note).
- **T3.3 (business/api):** stage-advance writes `OpportunityStageEvent` (the AI training signal); status change is separate from stage. Tests.
- **GATE.**

## Slice 4 — Channel + Deal Registration

**DoD:** Channel chain shows 4 nodes incl. 나(Platinum); a `DealRegistration` record drives the 딜등록 badge with gate states (보호/거절/만료/충돌); 딜등록 board (mockup 14) reads it; distributor modeled.

- **T4.1 (db):** `Partner.partnerType` → constrained values (`DISTRIBUTOR/RESELLER/VENDOR`); `Opportunity.distributorId String?` FK Partner. Migration.
- **T4.2 (db):** new `DealRegistration` model — `opportunityId @unique`, `distributorId`, `registrationNumber?`, `regStatus` (`NOT_SUBMITTED/SUBMITTED/APPROVED/REJECTED/EXPIRED/CONTESTED`), `protectionExpiresAt?`, `sprStatus?`, `partnerTierMargin? Decimal`. Indexes `[opportunityId]`, `[protectionExpiresAt, regStatus]`.
- **T4.3 (web):** restore 나(Platinum) node in `deal-record-header.tsx` chain; reg badge gate colors (`.reg.risk`); two-component margin (front + rebate note).
- **T4.4 (web):** `/deals/registrations` board (mockup 14) — columns = regStatus, cards = deals; risk states red. Reuse KanbanBoard.
- **GATE.**

## Slice 5 — Stage-tab internals (reuse existing modules)

**DoD:** Each stage tab in the workspace renders its real work surface, wired one tab at a time.

- **T5.1** ①제안 → proposal editor (reuse existing proposal/domain-proposal module) — mockup 05; AI rail = 제안서 초안.
- **T5.2** ②③ → `PocProject`/`PocResultReport` (backfill `opportunityId` first — prerequisite migration; make non-nullable going forward) — mockups 06/07.
- **T5.3** ④ → Quote/SPR — mockup 08.
- **T5.4** ⑤ → SOW/Quote + PO chain + milestones — mockup 09.
- **T5.5** ⑥ → `Engagement` (relax `@unique`→`[opportunityId,phase]`) + DeliveryChecklist — mockup 10. Absorb the Phase-3 AI domain hub here.
- **GATE per tab.**

## Slice 6 — CRM pages + convergence

**DoD:** 회사/연락처/총판·파트너 pages (mockups 11–13) + home dashboard (15) ship; the `/projects` Engagement hub becomes the ⑥딜리버리 tab; `/projects` is reclaimed as the deal home and relabeled 프로젝트; `/deals` merges in.

- **T6.1** 회사 목록+상세 (11). **T6.2** 연락처 (12). **T6.3** 총판·파트너 (13). **T6.4** 홈 대시보드 (15, KPIs+funnel+위험 리스트). **T6.5** convergence: move Engagement hub into ⑥ tab; reclaim `/projects`; redirect `/deals`. **GATE.**

---

## Self-review notes
- Spec coverage: §2 stage×status → S2.1/S3; §3 channel → S4; §5 spine/Opportunity → S1; §4 screens → S1/S2/S3/S5/S6; §6 service boundary → enforced per-tab in S5; §7 seams → ownerId (S2.1) + StageEvent training signal (S3.3); §8 slices → this doc; §11 guardrails → Global Constraints. CFO §10 → untouched.
- Each Slice = working, testable increment with its own gate (matches writing-plans scope rule).
- Slices 2–6 tasks are listed at task granularity (one agent each); their bite-sized TDD steps are expanded by the executing agent at task time, since they depend on the prior slice's real output (writing exact code now would be fiction).
