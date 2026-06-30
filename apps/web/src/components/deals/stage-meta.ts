/** Canonical opportunity-stage presentation (labels + board accents). */

// ---------------------------------------------------------------------------
// Display-stage mapping (6 presentation stages over 7 enum values).
// Pre-proposal enum values (LEAD, QUALIFIED, PROPOSAL) fold into ① 제안.
// ③ 결과제출 and ⑥ 딜리버리 have no enum source yet (added in later slices).
// ---------------------------------------------------------------------------
export const STAGE_DISPLAY: Record<string, { idx: number; label: string }> = {
  LEAD:        { idx: 1, label: "① 제안" },
  QUALIFIED:   { idx: 1, label: "① 제안" },
  PROPOSAL:    { idx: 1, label: "① 제안" },
  POC:         { idx: 2, label: "② PoC" },
  RESULT:      { idx: 3, label: "③ 결과제출" },
  NEGOTIATION: { idx: 4, label: "④ 선정·입찰" },
  WON:         { idx: 5, label: "⑤ 수주" },
  LOST:        { idx: 5, label: "⑤ 수주" }, // status=LOST shown via pill; stage is orthogonal
  DELIVERY:    { idx: 6, label: "⑥ 딜리버리" },
};

export function stageDisplay(stage: string): { idx: number; label: string } {
  return STAGE_DISPLAY[stage.toUpperCase()] ?? { idx: 1, label: stage };
}

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
