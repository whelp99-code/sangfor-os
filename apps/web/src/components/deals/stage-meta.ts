/** Canonical opportunity-stage presentation (labels + board accents). */
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
