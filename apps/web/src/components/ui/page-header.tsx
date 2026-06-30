import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

function formatTimestamp(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : "";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export type PageHeaderProps = {
  /** Plate 1 — page name. */
  title: string;
  /** Plate 1 — single-line purpose ("이 페이지에서 무엇을 하는가"). */
  description?: string;
  /** Plate 1 — up to 2 actions (primary + secondary). */
  actions?: ReactNode;
  /** Plate 2 — one-line status summary of the current situation. */
  status?: ReactNode;
  /** Plate 2 — last-updated marker, appended to the status line. */
  updatedAt?: string | Date;
  className?: string;
};

/**
 * Standard page masthead implementing the 4-Plate header contract
 * (docs/UX-AX-STANDARDS.md §3.1–3.2): title + one-line purpose on the left,
 * at most two actions on the right, and an optional status/last-updated line.
 */
export function PageHeader({
  title,
  description,
  actions,
  status,
  updatedAt,
  className,
}: PageHeaderProps) {
  const hasStatusLine = status != null || updatedAt != null;

  return (
    <header className={cn("space-y-2", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
          {description ? (
            <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>

      {hasStatusLine ? (
        <p
          className="text-sm text-muted-foreground"
          aria-live="polite"
          data-slot="page-status"
        >
          {status}
          {status != null && updatedAt != null ? " — " : null}
          {updatedAt != null ? (
            <span className="whitespace-nowrap">마지막 업데이트: {formatTimestamp(updatedAt)}</span>
          ) : null}
        </p>
      ) : null}
    </header>
  );
}
