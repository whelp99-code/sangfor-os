"use client";

import { CalendarDays, GanttChartSquare, KanbanSquare, Table2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { CollectionView } from "@/lib/use-collection-view";

const VIEW_META: Record<
  CollectionView,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  table: { label: "테이블", icon: Table2 },
  kanban: { label: "보드", icon: KanbanSquare },
  calendar: { label: "캘린더", icon: CalendarDays },
  timeline: { label: "타임라인", icon: GanttChartSquare },
};

export function ViewSwitcher({
  value,
  onChange,
  available = ["table", "kanban"],
  className,
}: {
  value: CollectionView;
  onChange: (view: CollectionView) => void;
  available?: CollectionView[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label="보기 전환"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border bg-muted/50 p-0.5",
        className
      )}
    >
      {available.map((view) => {
        const meta = VIEW_META[view];
        const Icon = meta.icon;
        const active = view === value;
        return (
          <button
            key={view}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(view)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-smooth",
              active
                ? "bg-background text-foreground shadow-sm ring-1 ring-foreground/10"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="size-3.5" />
            <span className="hidden sm:inline">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
