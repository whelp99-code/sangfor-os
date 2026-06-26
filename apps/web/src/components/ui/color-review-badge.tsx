"use client";

import { cn } from "@/lib/utils";
import { COLOR_AGENT_COLORS, displayStatus } from "@/lib/ux-labels";

interface ColorReviewBadgeProps {
  /** Color agent key: blue | red | orange | gray | teal */
  agent: string;
  /** Review status: passed | pending | failed | not_required */
  status: string;
  /** Optional custom label override */
  label?: string;
  /** Size variant */
  size?: "sm" | "md";
  className?: string;
}

const STATUS_ICONS: Record<string, string> = {
  passed: "✓",
  pending: "○",
  failed: "✕",
  not_required: "—",
  required: "●",
};

const STATUS_COLORS: Record<string, string> = {
  passed: "text-status-approved",
  pending: "text-status-pending",
  failed: "text-status-failed",
  not_required: "text-muted-foreground",
};

/**
 * Color Agent review status badge.
 * UX 원칙: 색상만으로 상태를 표시하지 않는다 → 아이콘 + 텍스트 + 색상 병행
 */
export function ColorReviewBadge({
  agent,
  status,
  label,
  size = "sm",
  className,
}: ColorReviewBadgeProps) {
  const colors = COLOR_AGENT_COLORS[agent];
  const statusColor = STATUS_COLORS[status] ?? "text-muted-foreground";
  const icon = STATUS_ICONS[status] ?? "?";

  const sizeStyles = size === "sm"
    ? "h-5 text-xs px-2 gap-1"
    : "h-6 text-sm px-2.5 gap-1.5";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium whitespace-nowrap transition-colors",
        colors.bg,
        colors.border,
        colors.text,
        sizeStyles,
        className,
      )}
      title={`${agent.toUpperCase()} — ${displayStatus(status)}`}
    >
      <span className={cn("shrink-0", statusColor)} aria-hidden="true">
        {icon}
      </span>
      <span className="truncate">{label ?? displayStatus(status)}</span>
    </span>
  );
}

/**
 * Color agent dot indicator (for tables/lists)
 */
export function ColorAgentDot({ agent, className }: { agent: string; className?: string }) {
  const colors = COLOR_AGENT_COLORS[agent];
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full shrink-0", colors?.dot ?? "bg-muted", className)}
      aria-hidden="true"
    />
  );
}
