import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type DealDetailSectionProps = {
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  columns?: 2 | 3;
  className?: string;
};

/**
 * Section wrapper for the structured deal detail block.
 * Renders a labelled section header + a responsive grid of inline fields.
 */
export function DealDetailSection({
  title,
  icon,
  children,
  columns = 3,
  className,
}: DealDetailSectionProps) {
  return (
    <div className={cn("px-4 py-1", className)}>
      {/* Section header */}
      <div className="mb-1 flex items-center gap-1.5 border-b border-border/60 pb-2 pt-3">
        {icon && (
          <span className="text-primary" aria-hidden="true">
            {icon}
          </span>
        )}
        <h3 className="text-[11px] font-extrabold uppercase tracking-wide text-foreground/70">
          {title}
        </h3>
      </div>

      {/* Field grid */}
      <div
        className={cn(
          "grid",
          columns === 3 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
          columns === 2 && "grid-cols-1 sm:grid-cols-2",
        )}
      >
        {children}
      </div>
    </div>
  );
}
