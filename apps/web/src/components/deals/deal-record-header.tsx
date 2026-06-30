import type { ReactNode } from "react";
import { ArrowRight, CalendarDays, CircleDollarSign, Handshake, ShieldCheck, Target } from "lucide-react";

import { formatKRWCompact, stageLabel } from "@/components/deals/stage-meta";
import { cn } from "@/lib/utils";

type DealRecordHeaderProps = {
  title: string;
  kind?: string;
  stage: string;
  probability?: number | null;
  amount?: number | string | null;
  customer?: string | null;
  partner?: string | null;
  nextAction?: string | null;
  closeDate?: string | Date | null;
  actions?: ReactNode;
  className?: string;
};

function formatAmount(value: number | string | null | undefined) {
  if (value == null || value === "") return "미정";
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? formatKRWCompact(numeric) : String(value);
}

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "미정";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "미정";
  return date.toISOString().slice(0, 10);
}

export function DealRecordHeader({
  title,
  kind = "딜 · Opportunity",
  stage,
  probability,
  amount,
  customer,
  partner,
  nextAction,
  closeDate,
  actions,
  className,
}: DealRecordHeaderProps) {
  const probabilityLabel = probability == null ? "미정" : `${probability}%`;

  return (
    <section className={cn("rounded-lg border bg-card p-4 shadow-sm", className)}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Target className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {kind}
              </p>
              <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
            <span className="rounded-full border bg-muted px-3 py-1">Sangfor</span>
            <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
            <span className="inline-flex items-center gap-1 rounded-full border bg-sky-50 px-3 py-1 text-sky-800 dark:bg-sky-950 dark:text-sky-200">
              <Handshake className="size-3" aria-hidden="true" />
              {partner ?? "파트너 미지정"}
            </span>
            <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />
            <span className="rounded-full border bg-emerald-50 px-3 py-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              {customer ?? "고객 미지정"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              <ShieldCheck className="size-3" aria-hidden="true" />
              딜 등록 검토
            </span>
          </div>
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      <dl className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <dt className="text-xs text-muted-foreground">현재 단계</dt>
          <dd className="mt-1 font-semibold">{stageLabel(stage)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">확률</dt>
          <dd className="mt-1 font-semibold tabular-nums">{probabilityLabel}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">예상 금액</dt>
          <dd className="mt-1 inline-flex items-center gap-1 font-semibold tabular-nums">
            <CircleDollarSign className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {formatAmount(amount)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">마감 예정</dt>
          <dd className="mt-1 inline-flex items-center gap-1 font-semibold">
            <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {formatDate(closeDate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">다음 액션</dt>
          <dd className="mt-1 truncate font-semibold">{nextAction ?? "미정"}</dd>
        </div>
      </dl>
    </section>
  );
}

type DealStagePathProps = {
  stage: string;
  className?: string;
};

const PATH_STAGES = ["LEAD", "QUALIFIED", "PROPOSAL", "POC", "NEGOTIATION", "WON"] as const;

export function DealStagePath({ stage, className }: DealStagePathProps) {
  const currentStage = stage.toUpperCase();
  const currentIndex = PATH_STAGES.indexOf(currentStage as (typeof PATH_STAGES)[number]);

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      <div className="grid gap-px bg-border p-px sm:grid-cols-2 lg:grid-cols-6">
        {PATH_STAGES.map((item, index) => {
          const isCurrent = item === currentStage;
          const isDone = currentIndex > index;
          return (
            <div
              key={item}
              className={cn(
                "flex min-h-11 items-center justify-center px-3 text-center text-xs font-semibold",
                isCurrent && "bg-primary text-primary-foreground",
                isDone && "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
                !isCurrent && !isDone && "bg-muted text-muted-foreground"
              )}
            >
              {stageLabel(item)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
