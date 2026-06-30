import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatKRW } from "@/components/deals/stage-meta";
import type { Deal } from "@/components/deals/types";

export function DealCard({ deal }: { deal: Deal }) {
  return (
    <Link
      href={`/opportunities/${deal.id}`}
      className="block rounded-lg border bg-card p-3 shadow-sm ring-1 ring-foreground/5 transition-smooth hover:ring-primary/30"
    >
      <p className="line-clamp-2 text-sm font-medium leading-snug">{deal.title}</p>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {deal.customer ?? "고객 미연결"}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold tabular-nums">
          {deal.amount != null ? formatKRW(deal.amount) : "—"}
        </span>
        <Badge variant="secondary" className="text-[10px] tabular-nums">
          {deal.probability}%
        </Badge>
      </div>
      {deal.nextAction ? (
        <p className="mt-2 line-clamp-1 text-xs text-muted-foreground">▸ {deal.nextAction}</p>
      ) : null}
    </Link>
  );
}
