import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Comma-group a number; pass through strings untouched. */
export function formatMetric(value: number | string): string {
  if (typeof value === "string") return value;
  return new Intl.NumberFormat("ko-KR").format(value);
}

export type MetricDelta = {
  /** Display value, e.g. "+120", "-1". */
  label: string;
  /** Direction of change for the arrow glyph. */
  direction?: "up" | "down" | "none";
  /**
   * Semantic tone — whether this change is good or bad for the user.
   * A metric going up is not always positive (e.g. delayed follow-ups).
   */
  tone?: "good" | "bad" | "neutral";
};

const toneClass: Record<NonNullable<MetricDelta["tone"]>, string> = {
  good: "text-status-approved",
  bad: "text-destructive",
  neutral: "text-muted-foreground",
};

export type MetricCardProps = {
  label: string;
  value: number | string;
  delta?: MetricDelta;
  icon?: React.ComponentType<{ className?: string }>;
  /** When set, the whole card becomes a navigation target (Plate 3 clickable). */
  href?: string;
  className?: string;
};

/**
 * Single KPI card per docs/UX-AX-STANDARDS.md §3.3: big number, muted label,
 * optional color-coded delta, optionally clickable to a filtered view.
 */
export function MetricCard({ label, value, delta, icon: Icon, href, className }: MetricCardProps) {
  const interactive = Boolean(href);
  const Arrow = delta?.direction === "down" ? ArrowDownRight : delta?.direction === "up" ? ArrowUpRight : null;

  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
          {formatMetric(value)}
        </span>
        {delta ? (
          <span
            className={cn(
              "flex items-center gap-0.5 text-sm font-medium tabular-nums",
              toneClass[delta.tone ?? "neutral"]
            )}
          >
            {Arrow ? <Arrow className="size-3.5" aria-hidden="true" /> : null}
            {delta.label}
          </span>
        ) : null}
      </div>
    </>
  );

  return (
    <Card
      size="sm"
      className={cn(
        "px-4 py-3",
        interactive &&
          "transition-smooth hover:ring-foreground/20 focus-within:ring-foreground/20",
        className
      )}
    >
      {href ? (
        <Link href={href} className="outline-none">
          {body}
        </Link>
      ) : (
        body
      )}
    </Card>
  );
}

/** Responsive container for up to 4 metric cards (§3.3 caps at four). */
export function MetricGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>
  );
}
