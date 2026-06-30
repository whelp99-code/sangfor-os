"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  regStatusMeta,
  regStatusBadgeVariant,
} from "@/components/deals/reg-status";
import { formatKRWCompact } from "@/components/deals/stage-meta";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RegBoardItem = {
  id: string;
  title: string;
  customer: string | null;
  amount: number | null;
  regStatus: string;
  protectionExpiresAt: string | null;
};

// ---------------------------------------------------------------------------
// Column definitions (mockup 14: 6 columns, order fixed)
// ---------------------------------------------------------------------------

type ColDef = {
  key: string;
  label: string;
  isRisk: boolean;
};

const COLUMNS: ColDef[] = [
  { key: "NOT_SUBMITTED", label: "미제출", isRisk: false },
  { key: "SUBMITTED",     label: "제출",   isRisk: false },
  { key: "APPROVED",      label: "승인",   isRisk: false },
  { key: "REJECTED",      label: "거절",   isRisk: true  },
  { key: "EXPIRED",       label: "만료",   isRisk: true  },
  { key: "CONTESTED",     label: "충돌",   isRisk: true  },
];

// ---------------------------------------------------------------------------
// RegCard
// ---------------------------------------------------------------------------

function RegCard({ item }: { item: RegBoardItem }) {
  const meta = regStatusMeta(item.regStatus, item.protectionExpiresAt);
  const badgeVariant = regStatusBadgeVariant(meta.tone);

  const subLine = [
    item.customer,
    item.amount != null ? formatKRWCompact(item.amount) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Link
      href={`/deals/${item.id}`}
      className={cn(
        "block rounded-lg border bg-card p-2.5 text-sm shadow-sm",
        "ring-1 ring-foreground/5 transition-colors hover:ring-primary/30",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        meta.tone === "risk" && "border-destructive/20 bg-destructive/5"
      )}
    >
      <p className="line-clamp-2 font-medium leading-snug">{item.title}</p>
      {subLine ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">{subLine}</p>
      ) : null}
      <div className="mt-2">
        <Badge variant={badgeVariant} className="text-[10px]">
          {meta.label}
        </Badge>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// RegistrationBoard
// ---------------------------------------------------------------------------

export function RegistrationBoard({ items }: { items: RegBoardItem[] }) {
  // Group items by regStatus
  const grouped = new Map<string, RegBoardItem[]>();
  for (const col of COLUMNS) {
    grouped.set(col.key, []);
  }
  for (const item of items) {
    const key = item.regStatus;
    if (grouped.has(key)) {
      grouped.get(key)!.push(item);
    } else {
      // fallback: unmapped statuses go to NOT_SUBMITTED
      grouped.get("NOT_SUBMITTED")!.push(item);
    }
  }

  return (
    <div
      className="grid auto-cols-[minmax(190px,1fr)] grid-flow-col gap-2.5 overflow-x-auto pb-2 scrollbar-thin"
      role="region"
      aria-label="딜 등록 칸반 보드"
    >
      {COLUMNS.map((col) => {
        const colItems = grouped.get(col.key) ?? [];
        return (
          <section
            key={col.key}
            aria-label={`${col.label} 열 (${colItems.length}건)`}
            className={cn(
              "flex flex-col rounded-xl border",
              col.isRisk
                ? "border-destructive/30 bg-destructive/5"
                : "bg-muted/30"
            )}
          >
            {/* Column header */}
            <header
              className={cn(
                "flex items-center justify-between border-b px-3 py-2",
                col.isRisk ? "border-destructive/20" : ""
              )}
            >
              <span
                className={cn(
                  "text-sm font-semibold",
                  col.isRisk ? "text-destructive" : "text-foreground"
                )}
              >
                {col.label}
              </span>
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] font-medium tabular-nums",
                  col.isRisk
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {colItems.length}
              </span>
            </header>

            {/* Cards */}
            <div className="flex min-h-28 flex-col gap-2 p-2">
              {colItems.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  비어 있음
                </p>
              ) : (
                colItems.map((item) => <RegCard key={item.id} item={item} />)
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
