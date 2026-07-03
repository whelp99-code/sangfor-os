export function formatDealCode(year: number, seq: number): string {
  return `PRJ-${year}-${String(seq).padStart(4, "0")}`;
}
