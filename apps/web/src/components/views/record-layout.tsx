import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Attio-style record detail shell: primary record column + sticky right rail
 * for activity / related objects.
 */
export function RecordLayout({
  main,
  aside,
  className,
}: {
  main: ReactNode;
  aside: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]", className)}>
      <div className="min-w-0 space-y-6">{main}</div>
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">{aside}</aside>
    </div>
  );
}
