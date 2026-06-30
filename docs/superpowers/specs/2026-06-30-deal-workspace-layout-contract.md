# Deal Workspace — Layout Contract (SSOT for UI)

> Status: Binding · Date: 2026-06-30 · Pairs with `2026-06-30-deal-workspace-hub-design.md`

## 0. Principle — the layout is the source of truth

The three approved mockups in `./mockups/` are the **single source of truth for UI
structure**. All code and the build workflow derive from them. The rules:

1. **Structure, regions, field inventory, and density are BINDING.** A screen's
   component tree must match the mockup's regions; every field listed below must appear.
2. **Color/hue is NOT binding — it maps to the app's design system.** The mockups use
   hardcoded Salesforce-azure hex for illustration. Real code uses the app's **Tailwind v4
   + shadcn semantic tokens** (oklch). Never hardcode the mockup hex. See §2 mapping.
3. **Change control:** any UI change updates the mockup FIRST, then the code. Code that
   diverges from the mockup is a defect, not a variation. The mockup is reviewed; the code conforms.
4. Reuse existing infrastructure (`DataView`, `@tanstack/react-table`, shadcn `ui/*`, lucide).
   Do not introduce a parallel table/badge/button system.

## 1. Canonical mockups

| File | Screen | Spec ref |
|---|---|---|
| `mockups/01-deal-list.html` | 딜 목록 (table, `/deals`) | design §4 screen 1 |
| `mockups/02-deal-workspace.html` | 딜 작업화면 (Highlights/Path/Tabs/AI rail) | design §4 screen 2 |
| `mockups/03-deal-detail.html` | 딜 상세 (sections, inline edit) | design §4 screen 3 |

## 2. Token mapping — mockup hex → app shadcn token (BINDING)

Stack: Tailwind v4 `@theme` + shadcn (`style: base-nova`, base `neutral`, lucide).
`--primary` is oklch(0.37 0.12 265) (deep indigo-blue) — the accent ROLE is binding,
the exact hue follows the app token, NOT the mockup's brighter azure.

| Mockup var (illustrative) | Role | App token (use this) |
|---|---|---|
| `--sf-blue #0176d3` | primary accent / links / current stage | `--primary` / `text-primary` |
| `--sf-blue-d` | accent text on tint | `--primary` (darker via token) |
| `--sf-bg #f3f2f2` | page background | `--background` / `--muted` |
| `--sf-card #fff` | card/panel surface | `--card` |
| `--sf-border #e5e5e5` | borders, dividers | `--border` |
| `--sf-text #181818` | primary text | `--foreground` |
| `--sf-text-weak #5c5c5c` | labels, secondary | `--muted-foreground` |
| green `#1d6b39 / #eafaf0` | success / 보호중 / done | status token `success` (add if absent) |
| amber `#c4690a / #fff4e6` | warning / SPR 검토중 / 딜등록 배지 | status token `warning` |
| red `#b42318 / #fdecec` | risk / 미등록 / REJECTED·EXPIRED·CONTESTED | `--destructive` |
| gray `#777 / #f0f0f0` | todo / 완료(neutral) | `--muted` / `--muted-foreground` |
| radius `8px` | card radius | `--radius` (0.625rem) |
| font Pretendard/AppleSD | CJK-first body | `--font-sans` (existing) |

Status pills render as shadcn `Badge`; the success/warning/risk/neutral set is the
**only** status palette (define `success`/`warning` tokens once in `globals.css` if missing).

## 3. Screen 1 — 딜 목록 (`mockups/01-deal-list.html`)

**Regions (binding):** topbar(nav) → list-header(title + view selector + count + 필터/열설정/`+새 딜`) →
stage filter chips (①–⑥) + totals(labeled "진행중 N건 · 가중 예상마진") → table → 🔑 Project-ID 연결키 note.

**Columns (binding order):** ☐select · **Project ID**(code, mono, primary link) · 딜/고객사(name+sub) ·
총판 · 제품군 · **단계**(mini 6-pip + label + status) · 공급가(num) · 마진%(num, derived/read-only) ·
딜등록(Badge) · 담당 · 마감 · ⋯row-actions. **Cells inline-editable** (except derived margin).

**Components / reuse:** `deals-table.tsx` on `DataView` + `@tanstack/react-table` `ColumnDef`;
`Badge` for 단계·상태·딜등록 pills; `Input` for inline cell edit; lucide icons. Row click → `/deals/[id]`.

## 4. Screen 2 — 딜 작업화면 (`mockups/02-deal-workspace.html`)

**Regions (binding, top→bottom):**
1. **Highlights** — record icon · kind label · deal name · actions(편집 / 활동 기록 / 단계 완료) ·
   **채널 체인**(Sangfor ▸ 총판 ▸ 나·Platinum ▸ 고객) · **딜등록 상태 배지** · key fields(고객사·금액·담당·마감·현재단계·확률).
2. **Path** — 6 chevrons (done/cur/todo) carrying stage **and** status.
3. **단계 가이드** — stage tag · 통과기준 · 단계완료(advisory) · 표준 산출물 checklist.
4. **Body grid** — left: **작업 탭**(작업/상세/문서/연락처/채널·등록), lazy-loaded per tab;
   right rail: **✦ AI 거들기**(stage-specific suggestion, [수락]/[나중에] + note) + **활동 타임라인**.

**Components:** `deal-workspace-layout.tsx` (region shell) + `deal-highlights.tsx`,
`deal-stage-path.tsx`, `deal-stage-guide.tsx`, shadcn `Tabs` for work tabs, `deal-ai-rail.tsx`,
`deal-activity-timeline.tsx`. AI assist lives ONLY in the right rail (design §11.4).

## 5. Screen 3 — 딜 상세 (`mockups/03-deal-detail.html`)

**Regions:** Highlights(condensed) → Path → tabs(작업/상세/문서/연락처/채널·등록/활동) →
detail body: **5 sections**, every field a row(label · value · ✎ inline edit), one field editing-state demo, `+필드 추가`.

**Sections + field inventory (binding):**
| Section | Fields (binding) | Notes |
|---|---|---|
| 딜 정보 | 딜명, 딜유형(dealType), 제품군, 수량/모델, 공급가, 매입원가, **마진(read-only)**, 확률(read-only), 현재단계 | derived = read-only (design §4) |
| 채널·딜등록 | 총판, 딜등록 번호, 등록대행, **regStatus**(보호/거절/만료/충돌), SPR, Platinum 마진 | gate states red (design §3) |
| 고객·의사결정 | 고객사, 산업, 주연락처, **Economic Buyer**, **Champion**, 경쟁사 | EB/Champion = structured refs (design §5) |
| 자격검증 (BANT) | budget/authority/need/timeline + **EconomicBuyer·Champion** | BANT + 2, NOT full MEDDPICC (design D-qual) |
| 일정 | 제안일, PoC기간, 입찰일, 납품일 | |

**Components:** `deal-detail.tsx` + `deal-detail-section.tsx` + `inline-field.tsx`
(label/value/edit affordance, shadcn `Input`/`Select`, optimistic save). Default view =
essential fields; rest behind 전체 편집/더보기 (design §4, red-team M1).

## 6. Workflow binding

- The Slice plan (design §8) implements screens **in this layout's component order**:
  Slice 1 = §3 (deal list) only. Slice 2 = §5 (detail). Slice 3 = §4 Path/guide. Etc.
- Each component above is the unit of work. A slice is "done" when its screen renders the
  mockup's regions/fields with real data and the token mapping (§2), zero mock data.
- Before building any screen, open its mockup; after building, diff against it.
