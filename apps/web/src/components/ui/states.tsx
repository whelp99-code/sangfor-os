import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

type StateContainerProps = {
  children: ReactNode;
  className?: string;
  /** Render inline (inside a card/table) with tighter padding. */
  inline?: boolean;
};

function StateContainer({ children, className, inline }: StateContainerProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center",
        inline ? "px-4 py-10" : "rounded-xl border border-dashed border-border px-6 py-14",
        className
      )}
    >
      {children}
    </div>
  );
}

export type EmptyStateProps = {
  /** Why is this empty? */
  title: string;
  /** What can the user do right now? */
  description?: string;
  /** lucide icon component, e.g. `Inbox`. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Primary action (and optionally a secondary one). */
  action?: ReactNode;
  inline?: boolean;
  className?: string;
};

/**
 * Empty state per docs/UX-AX-STANDARDS.md §3.5 — never a bare "데이터 없음".
 * Always: situation + next-step suggestion + action affordance.
 */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  inline,
  className,
}: EmptyStateProps) {
  return (
    <StateContainer inline={inline} className={className}>
      <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action ? <div className="flex flex-wrap items-center justify-center gap-2 pt-1">{action}</div> : null}
    </StateContainer>
  );
}

export type LoadingStateProps = {
  label?: string;
  inline?: boolean;
  className?: string;
};

/** Standard loading state with a labelled spinner and live-region announcement. */
export function LoadingState({
  label = "데이터를 불러오는 중입니다…",
  inline,
  className,
}: LoadingStateProps) {
  return (
    <StateContainer inline={inline} className={cn("border-transparent", className)}>
      <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {label}
      </p>
    </StateContainer>
  );
}

export type ErrorStateProps = {
  title?: string;
  message: string;
  action?: ReactNode;
  inline?: boolean;
  className?: string;
};

/** Standard error state — clear cause + recovery affordance. */
export function ErrorState({
  title = "정보를 불러오지 못했습니다",
  message,
  action,
  inline,
  className,
}: ErrorStateProps) {
  return (
    <StateContainer
      inline={inline}
      className={cn("border-destructive/30 bg-destructive/5", className)}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="size-5" />
      </span>
      <div className="space-y-1" role="alert">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">{message}</p>
      </div>
      {action ? <div className="flex flex-wrap items-center justify-center gap-2 pt-1">{action}</div> : null}
    </StateContainer>
  );
}
