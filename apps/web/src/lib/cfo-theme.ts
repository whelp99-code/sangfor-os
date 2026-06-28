// CFO console design tokens — "ink on ledger" direction.
// Deliberately avoids the cream-serif / black-acid / broadsheet AI defaults.
export const CFO = {
  ink: "#0F1A2B", // deep navy-ink: headers, hero, primary figures
  paper: "#FBFAF8", // warm off-white surface (tuned away from #F4F1EA)
  hairline: "#E7E3DA", // ledger rule lines
  muted: "#6B7280", // secondary labels
  inflow: "#1B7A5A", // deposits / profit (deep teal-green)
  outflow: "#B4413A", // payments / loss (muted brick)
  brass: "#C8A24B", // signature accent — used with restraint
} as const;

export const krw = (n: number) => `₩${Math.round(n ?? 0).toLocaleString("ko-KR")}`;
