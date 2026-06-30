export const dynamic = "force-dynamic";

import { Shield } from "lucide-react";

import { listOpportunities } from "@sangfor/business";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";
import { RegistrationBoard } from "@/components/deals/registration-board";
import type { RegBoardItem } from "@/components/deals/registration-board";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/**
 * Count APPROVED registrations whose protection expires within 14 days from now.
 */
function countExpiringSoon(items: RegBoardItem[]): number {
  const now = Date.now();
  const threshold = 14 * MS_PER_DAY;
  return items.filter((item) => {
    if (item.regStatus !== "APPROVED") return false;
    if (!item.protectionExpiresAt) return false;
    const expiresMs = new Date(item.protectionExpiresAt).getTime();
    if (Number.isNaN(expiresMs)) return false;
    return expiresMs - now <= threshold && expiresMs >= now;
  }).length;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DealRegistrationsPage() {
  const raw = await listOpportunities();
  const safe = serializeDecimalAtBoundary(raw);

  // Map to the serializable shape the board component expects.
  const items: RegBoardItem[] = safe.map((opp) => ({
    id: opp.id,
    title: opp.title,
    customer: opp.customer?.name ?? null,
    amount:
      typeof opp.amount === "number"
        ? opp.amount
        : opp.amount != null
          ? Number(opp.amount)
          : null,
    regStatus: opp.dealRegistration?.regStatus ?? "NOT_SUBMITTED",
    protectionExpiresAt: opp.dealRegistration?.protectionExpiresAt
      ? new Date(opp.dealRegistration.protectionExpiresAt).toISOString()
      : null,
  }));

  const expiringSoon = countExpiringSoon(items);

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
            aria-hidden="true"
          >
            <Shield className="size-4" />
          </span>
          <div>
            <h1 className="text-base font-bold leading-tight">
              딜 등록 관리
              {expiringSoon > 0 && (
                <span className="ml-2 text-sm font-medium text-destructive">
                  · 보호 만료 임박 {expiringSoon}건
                </span>
              )}
            </h1>
            <p className="mt-0.5 text-xs font-medium text-destructive">
              딜 등록은 총판이 대행. 거절·만료·충돌은 즉시 대응 (빨강).
            </p>
          </div>
        </div>
      </div>

      {/* Kanban board */}
      <div className="rounded-xl border bg-card p-3">
        <RegistrationBoard items={items} />
      </div>
    </div>
  );
}
