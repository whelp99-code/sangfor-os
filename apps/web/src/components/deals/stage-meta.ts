/** Canonical opportunity-stage presentation (labels + board accents). */

import { normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";

// ---------------------------------------------------------------------------
// Work-PHASE display model (6 phases) — used by the deal record work tab,
// AI rail, and the stage-path progress header (deal-work-tab / deal-ai-rail /
// deal-record-header). This is intentionally a SUPERSET of the Prisma
// OpportunityStage enum: ③ 결과제출(RESULT) and ⑥ 딜리버리(DELIVERY) are
// workflow phases (PoC result submission, post-WON delivery) that the work
// surfaces render as their own panels. They are NOT OpportunityStage enum
// values and therefore must never be offered as stage FILTER chips or kanban
// columns (doing so PATCHes an invalid stage → 400 + permanently empty
// column). The stage chips/board derive from the enum instead — see
// STAGE_CHIP_GROUPS below and deals-board.tsx (which uses CANONICAL_STAGES).
//
// idx legend (work-phase router in deal-work-tab.tsx):
//   1 ① 제안   ← LEAD / QUALIFIED / PROPOSAL
//   2 ② PoC    ← POC
//   3 ③ 결과제출 ← (no enum value — derived from PoC results context)
//   4 ④ 선정·입찰 ← NEGOTIATION
//   5 ⑤ 수주   ← WON
//   6 ⑥ 딜리버리 ← (no enum value — post-WON delivery/Engagement)
// ---------------------------------------------------------------------------
export const STAGE_DISPLAY: Record<string, { idx: number; label: string }> = {
  LEAD:        { idx: 1, label: "① 제안" },
  QUALIFIED:   { idx: 1, label: "① 제안" },
  PROPOSAL:    { idx: 1, label: "① 제안" },
  POC:         { idx: 2, label: "② PoC" },
  RESULT:      { idx: 3, label: "③ 결과제출" }, // work-phase only — not an enum stage
  NEGOTIATION: { idx: 4, label: "④ 선정·입찰" },
  WON:         { idx: 5, label: "⑤ 수주" },
  // NOTE: LOST is a terminal outcome, NOT an active pipeline stage. Its idx
  // mapping here is purely presentational (keeps the UI at stage ⑤ 수주 while
  // the status pill separately shows the LOST state). No behavioral meaning
  // should be inferred from this entry.
  LOST:        { idx: 5, label: "⑤ 수주" }, // status=LOST shown via pill; stage is orthogonal
  DELIVERY:    { idx: 6, label: "⑥ 딜리버리" }, // work-phase only — not an enum stage
};

export function stageDisplay(stage: string): { idx: number; label: string } {
  const upper = stage.toUpperCase();
  // RESULT / DELIVERY are work-phase-only keys with no enum equivalent; look
  // them up directly so the work tab can route to their panels. All real
  // enum stages are normalized first so legacy labels resolve correctly.
  if (STAGE_DISPLAY[upper]) return STAGE_DISPLAY[upper];
  const canonical = normalizeOpportunityStage(stage);
  return STAGE_DISPLAY[canonical] ?? { idx: 1, label: canonical };
}

// ---------------------------------------------------------------------------
// Stage FILTER chip groups — derived ONLY from the Prisma OpportunityStage
// enum (the single source of truth for stage values a deal can actually hold).
// Each group folds one or more enum values under a display label. WON keeps
// its own group; LOST is a terminal outcome surfaced via the status pill, not
// a filter chip. This is what deals-workspace renders, guaranteeing the chips
// and the kanban board (deals-board, which uses the same enum) never drift.
// ---------------------------------------------------------------------------
export type StageChipGroup = { label: string; enumValues: string[] };

export const STAGE_CHIP_GROUPS: StageChipGroup[] = [
  { label: "① 제안", enumValues: ["LEAD", "QUALIFIED", "PROPOSAL"] },
  { label: "② PoC", enumValues: ["POC"] },
  { label: "④ 선정·입찰", enumValues: ["NEGOTIATION"] },
  { label: "⑤ 수주", enumValues: ["WON"] },
];

export const STAGE_LABELS: Record<string, string> = {
  LEAD: "리드",
  QUALIFIED: "검증",
  PROPOSAL: "제안",
  POC: "PoC",
  NEGOTIATION: "협상",
  WON: "수주",
  LOST: "실패",
};

export const STAGE_ACCENT: Record<string, string> = {
  LEAD: "bg-chart-2",
  QUALIFIED: "bg-chart-1",
  PROPOSAL: "bg-chart-4",
  POC: "bg-chart-5",
  NEGOTIATION: "bg-chart-3",
  WON: "bg-status-approved",
  LOST: "bg-destructive",
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage.toUpperCase()] ?? stage;
}

export function formatKRW(amount: number): string {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatKRWCompact(amount: number): string {
  return new Intl.NumberFormat("ko-KR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(amount);
}
