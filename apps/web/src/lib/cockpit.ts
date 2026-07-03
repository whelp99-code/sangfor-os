// 계기판 화면 공용 매핑 헬퍼 — 역할 AI, 워크플로 태그, 도메인, D-day, 재검증 신호.

export const ROLE: Record<string, { cls: string; badge: string; label: string }> = {
  customer: { cls: "mk", badge: "MK", label: "마케팅 AI" },
  partner: { cls: "mk", badge: "MK", label: "마케팅 AI" },
  opportunity: { cls: "ps", badge: "PS", label: "프리세일즈 AI" },
  poc: { cls: "en", badge: "EN", label: "엔지니어 AI" },
  task: { cls: "sa", badge: "SA", label: "영업 AI" },
};
export function roleFor(t: string) {
  return ROLE[t] ?? { cls: "sa", badge: "SA", label: "영업 AI" };
}

export const TYPE_KO: Record<string, string> = {
  customer: "고객 후보",
  partner: "파트너 후보",
  opportunity: "영업기회 후보",
  poc: "PoC 후보",
  task: "작업 후보",
};

// 후보 유형 → 워크플로 (신규영업 n / 리뉴얼 r / 기술지원 s)
export function wfFor(candidateType: string, title?: string | null): "n" | "r" | "s" {
  const t = (title ?? "").toLowerCase();
  if (t.includes("갱신") || t.includes("리뉴얼") || t.includes("renew")) return "r";
  if (candidateType === "poc") return "n";
  return "n";
}
export const WF_KO: Record<"n" | "r" | "s", string> = {
  n: "신규영업",
  r: "리뉴얼",
  s: "기술지원",
};

export function domainOf(sender: string | null | undefined): string {
  if (!sender) return "—";
  const at = sender.indexOf("@");
  return at >= 0 ? sender.slice(at + 1) : sender;
}

export function daysUntil(d: Date | null | undefined): number | null {
  if (!d) return null;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
}

export function won(n: number | null | undefined): string {
  return "₩" + Math.round(Number(n ?? 0)).toLocaleString("ko-KR");
}

export type Reval =
  | "approve_candidate"
  | "needs_human_review"
  | "reject"
  | "knowledge_only";
export function revalOf(metadata: unknown): Reval | null {
  if (metadata && typeof metadata === "object") {
    const r = (metadata as Record<string, unknown>).aiRevalidation;
    if (r && typeof r === "object") {
      const d = (r as Record<string, unknown>).decision;
      if (typeof d === "string") return d as Reval;
    }
  }
  return null;
}
