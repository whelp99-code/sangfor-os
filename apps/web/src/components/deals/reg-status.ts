/**
 * Shared helper that maps a raw DealRegistration regStatus enum value
 * to a display label, tone, and optional D-day string.
 *
 * Tones map to shadcn semantic tokens:
 *   ok   -> emerald (보호중)
 *   warn -> amber   (검토중)
 *   risk -> destructive (거절 / 만료 / 충돌)
 *   muted-> muted   (미등록 / null)
 */
export type RegStatusTone = "ok" | "warn" | "risk" | "muted";

export type RegStatusMeta = {
  label: string;
  tone: RegStatusTone;
  dday?: string;
};

/**
 * Returns display metadata for a deal-registration gate state.
 *
 * @param regStatus - Raw enum string from the DealRegistration model, or null.
 * @param protectionExpiresAt - ISO date string for APPROVED protection expiry. Used to compute D-day.
 */
export function regStatusMeta(
  regStatus: string | null | undefined,
  protectionExpiresAt?: string | Date | null,
): RegStatusMeta {
  switch (regStatus) {
    case "APPROVED": {
      const dday = computeDday(protectionExpiresAt);
      return {
        label: dday ? `보호중 · ${dday}` : "보호중",
        tone: "ok",
        ...(dday ? { dday } : {}),
      };
    }
    case "SUBMITTED":
      return { label: "검토중", tone: "warn" };
    case "REJECTED":
      return { label: "거절", tone: "risk" };
    case "EXPIRED":
      return { label: "만료", tone: "risk" };
    case "CONTESTED":
      return { label: "충돌", tone: "risk" };
    case "NOT_SUBMITTED":
    default:
      return { label: "미등록", tone: "muted" };
  }
}

/**
 * Computes a D-day string ("D-45", "D-0", "D+3") relative to today.
 * Returns undefined when the date is absent or invalid.
 */
function computeDday(value?: string | Date | null): string | undefined {
  if (!value) return undefined;
  const target = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(target.getTime())) return undefined;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const diff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diff > 0) return `D-${diff}`;
  if (diff === 0) return "D-0";
  return `D+${Math.abs(diff)}`;
}

/**
 * Maps a RegStatusTone to the shadcn/Tailwind classes used in the deals table Badge.
 * risk=destructive, ok=emerald, warn=amber, muted=secondary.
 */
/**
 * Returns the shadcn Badge variant for each reg-status tone.
 * "ok" uses "outline" so that emerald className overrides can take effect
 * at the call site (matching the emerald treatment in deal-record-header.tsx).
 */
export function regStatusBadgeVariant(
  tone: RegStatusTone,
): "default" | "secondary" | "destructive" | "outline" {
  switch (tone) {
    case "ok":
      return "outline";
    case "warn":
      return "outline";
    case "risk":
      return "destructive";
    case "muted":
    default:
      return "secondary";
  }
}

/**
 * Returns extra Tailwind className overrides for the reg-status Badge.
 * Call site should merge this with the Badge className prop.
 */
export function regStatusBadgeClassName(tone: RegStatusTone): string {
  switch (tone) {
    case "ok":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300";
    case "warn":
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
    case "risk":
      return "";
    case "muted":
    default:
      return "";
  }
}

/**
 * Returns Tailwind classes for inline colored spans (not using Badge variant).
 * Matches deal-record-header gate-color treatment.
 */
export function regStatusInlineClasses(tone: RegStatusTone): string {
  switch (tone) {
    case "ok":
      return "text-emerald-700 dark:text-emerald-300";
    case "warn":
      return "text-amber-700 dark:text-amber-300";
    case "risk":
      return "text-destructive";
    case "muted":
    default:
      return "text-muted-foreground";
  }
}
