import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

/** Mirrors @sangfor/infra IntegrationStatus. */
export type IntegrationStatus = "healthy" | "degraded" | "unreachable" | "unknown";

type StatusMeta = {
  /** Korean label paired with the dot/icon so meaning never relies on color alone. */
  label: string;
  Icon: LucideIcon;
  /** Tailwind utility classes for the icon/text accent. */
  accent: string;
  /** Solid dot color (status indicator). */
  dot: string;
  /** Tinted pill background + border. */
  pill: string;
};

export const STATUS_META: Record<IntegrationStatus, StatusMeta> = {
  healthy: {
    label: "정상",
    Icon: CheckCircle2,
    accent: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20",
  },
  degraded: {
    label: "성능저하",
    Icon: AlertTriangle,
    accent: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20",
  },
  unreachable: {
    label: "연결불가",
    Icon: XCircle,
    accent: "text-red-600 dark:text-red-400",
    dot: "bg-red-500",
    pill: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20",
  },
  unknown: {
    label: "확인불가",
    Icon: HelpCircle,
    accent: "text-muted-foreground",
    dot: "bg-zinc-400",
    pill: "bg-muted text-muted-foreground border-border",
  },
};

export function normalizeStatus(status: string): IntegrationStatus {
  return status in STATUS_META ? (status as IntegrationStatus) : "unknown";
}

/**
 * Accessible status pill: color + icon + text label together, with an
 * aria-label so screen readers announce the state explicitly.
 */
export function StatusPill({
  status,
  className,
}: {
  status: IntegrationStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  const { Icon } = meta;
  return (
    <span
      role="status"
      aria-label={`상태: ${meta.label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold",
        meta.pill,
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {meta.label}
    </span>
  );
}
