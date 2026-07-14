import { cn } from "@/lib/utils";
import { formatKRW, stageDisplay } from "@/components/deals/stage-meta";
import { DealTitle } from "@/components/deals/deal-title-display";
import type { Deal } from "@/components/deals/types";

const TOTAL_PIPS = 6;

export function DealMobileCard({ deal }: { deal: Deal }) {
  const { idx, label } = stageDisplay(deal.stage);
  const isLost = deal.dealStatus === "LOST";

  return (
    <div className={cn(isLost && "opacity-60")}>
      <DealTitle title={deal.title} className="text-sm font-semibold leading-snug break-keep" />
      <p className="mt-1 text-xs text-muted-foreground">{deal.customer ?? "고객 미지정"}</p>

      <div className="mt-2.5 flex items-center justify-between border-t pt-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
          <span className="flex items-center gap-0.5" aria-hidden>
            {Array.from({ length: TOTAL_PIPS }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "size-1 rounded-full",
                  i + 1 <= idx ? "bg-primary" : "bg-muted-foreground/25",
                )}
              />
            ))}
          </span>
          {label}
        </span>
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            deal.amount == null && "font-normal text-muted-foreground",
          )}
        >
          {deal.amount == null ? "—" : formatKRW(deal.amount)}
        </span>
      </div>

      {deal.nextAction ? (
        <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground">
          <span className="shrink-0 font-semibold text-primary">다음</span>
          <span className="line-clamp-1">{deal.nextAction}</span>
        </p>
      ) : null}
    </div>
  );
}
