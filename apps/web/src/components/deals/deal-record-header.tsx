import type { ReactNode } from "react";
import { ArrowRight, CalendarDays, CircleDollarSign, Handshake, ShieldCheck, Target, User } from "lucide-react";

import { formatKRWCompact, stageDisplay } from "@/components/deals/stage-meta";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Gate states for the deal-registration badge (mockup 02/03 § .chain .reg). */
type RegStatus = "보호중" | "검토중" | "거절" | "만료" | "충돌" | null;

type DealRecordHeaderProps = {
  title: string;
  kind?: string;
  stage: string;
  probability?: number | null;
  amount?: number | string | null;
  customer?: string | null;
  partner?: string | null;
  /** Owner / assigned rep display name. Optional – renders "미정" when absent. */
  owner?: string | null;
  nextAction?: string | null;
  closeDate?: string | Date | null;
  /** Deal-registration gate state. Controls badge color. Null → default "딜 등록" amber. */
  regStatus?: RegStatus;
  actions?: ReactNode;
  className?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

/**
 * Resolve semantic Tailwind token classes for each deal-reg gate state.
 * Colors follow mockup 02/03: ok→emerald, warn→amber, risk→destructive.
 * No hardcoded hex — only semantic/utility tokens supported by shadcn.
 */
function regBadgeClasses(status: RegStatus): string {
  switch (status) {
    case "보호중":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300";
    case "검토중":
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
    case "거절":
    case "만료":
    case "충돌":
      return "border-destructive/30 bg-destructive/10 text-destructive";
    default:
      // null → default amber "딜 등록" (matches original)
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200";
  }
}

function regBadgeLabel(status: RegStatus): string {
  if (!status) return "딜 등록";
  return `딜 등록 ${status}`;
}

// ---------------------------------------------------------------------------
// DealRecordHeader
// ---------------------------------------------------------------------------

export function DealRecordHeader({
  title,
  kind = "딜 · Opportunity",
  stage,
  probability,
  amount,
  customer,
  partner,
  owner,
  nextAction: _nextAction,
  closeDate,
  regStatus = null,
  actions,
  className,
}: DealRecordHeaderProps) {
  const probabilityLabel = probability == null ? "미정" : `${probability}%`;
  const { label: stageLabel } = stageDisplay(stage);

  return (
    <section className={cn("rounded-lg border bg-card p-4 shadow-sm", className)}>
      {/* ── Title row ────────────────────────────────────────────────────────── */}
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

          {/* ── 4-node channel chain (Sangfor → 총판 → 나·Platinum → 고객) ─── */}
          <div
            className="flex flex-wrap items-center gap-2 text-xs font-medium"
            aria-label="채널 체인"
          >
            {/* Node 1: Sangfor (vendor) */}
            <span className="rounded-full border bg-muted px-3 py-1">Sangfor</span>

            <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />

            {/* Node 2: Distributor (총판) — uses partner field until dedicated distributor field exists */}
            <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-3 py-1 text-muted-foreground">
              {partner ?? "총판 미지정"}
            </span>

            <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />

            {/* Node 3: Me · Platinum (highlighted — matches mockup .node.me) */}
            <span className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary">
              <Handshake className="size-3" aria-hidden="true" />
              나 · Platinum
            </span>

            <ArrowRight className="size-3 text-muted-foreground" aria-hidden="true" />

            {/* Node 4: Customer (matches mockup .node.cust) */}
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
              {customer ?? "고객 미지정"}
            </span>

            {/* Deal-reg badge — pushed to right via ml-auto, color by gate state */}
            <span
              className={cn(
                "ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1",
                regBadgeClasses(regStatus)
              )}
              aria-label={`딜 등록 상태: ${regBadgeLabel(regStatus)}`}
            >
              <ShieldCheck className="size-3" aria-hidden="true" />
              {regBadgeLabel(regStatus)}
            </span>
          </div>
        </div>

        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {/* ── Key fields row (mockup 02 § .kf — 6 columns) ───────────────────── */}
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t pt-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
        {/* 고객사 */}
        <div>
          <dt className="text-xs text-muted-foreground">고객사</dt>
          <dd className="mt-1 truncate font-semibold">{customer ?? "미정"}</dd>
        </div>

        {/* 금액 */}
        <div>
          <dt className="text-xs text-muted-foreground">금액</dt>
          <dd className="mt-1 inline-flex items-center gap-1 font-semibold tabular-nums">
            <CircleDollarSign className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {formatAmount(amount)}
          </dd>
        </div>

        {/* 담당 */}
        <div>
          <dt className="text-xs text-muted-foreground">담당</dt>
          <dd className="mt-1 inline-flex items-center gap-1 font-semibold">
            <User className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {owner ?? "미정"}
          </dd>
        </div>

        {/* 마감 예정 */}
        <div>
          <dt className="text-xs text-muted-foreground">마감 예정</dt>
          <dd className="mt-1 inline-flex items-center gap-1 font-semibold">
            <CalendarDays className="size-3.5 text-muted-foreground" aria-hidden="true" />
            {formatDate(closeDate)}
          </dd>
        </div>

        {/* 현재 단계 */}
        <div>
          <dt className="text-xs text-muted-foreground">현재 단계</dt>
          <dd className="mt-1 font-semibold text-primary">{stageLabel}</dd>
        </div>

        {/* 수주 확률 */}
        <div>
          <dt className="text-xs text-muted-foreground">수주 확률</dt>
          <dd className="mt-1 font-semibold tabular-nums">{probabilityLabel}</dd>
        </div>
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// DealStagePath — 6-stage chevron path (mockup 02/03 § .path)
// ---------------------------------------------------------------------------

/**
 * The 6 display stages shown in the chevron path, ordered by their display index.
 * Mapped from enum → display via STAGE_DISPLAY in stage-meta.ts.
 */
const DISPLAY_STAGES: { idx: number; label: string }[] = [
  { idx: 1, label: "① 제안" },
  { idx: 2, label: "② PoC" },
  { idx: 3, label: "③ 결과제출" },
  { idx: 4, label: "④ 선정·입찰" },
  { idx: 5, label: "⑤ 수주" },
  { idx: 6, label: "⑥ 딜리버리" },
];

type DealStagePathProps = {
  stage: string;
  /** When "LOST", the current (reached) stage is capped in destructive red. */
  dealStatus?: string | null;
  className?: string;
};

export function DealStagePath({ stage, dealStatus, className }: DealStagePathProps) {
  const { idx: currentIdx } = stageDisplay(stage);
  const isLost = dealStatus === "LOST";

  return (
    <div className={cn("overflow-hidden rounded-lg border bg-card", className)}>
      <ol
        className="flex"
        aria-label="딜 단계 진행상황"
        style={{ listStyle: "none", padding: 0, margin: 0 }}
      >
        {DISPLAY_STAGES.map((displayStage, arrayIndex) => {
          const isCurrent = displayStage.idx === currentIdx;
          const isDone = displayStage.idx < currentIdx;
          const isFirst = arrayIndex === 0;

          // Chevron clip-path (mockup .path li)
          // First item has no left notch; subsequent items have both left notch + right point.
          const clipPath = isFirst
            ? "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%)"
            : "polygon(0 0, calc(100% - 14px) 0, 100% 50%, calc(100% - 14px) 100%, 0 100%, 14px 50%)";

          return (
            <li
              key={displayStage.idx}
              className={cn(
                "relative flex min-h-[42px] flex-1 items-center justify-center px-3 text-center text-xs font-semibold",
                // Current stage: primary (or destructive if LOST)
                isCurrent && !isLost && "bg-primary text-primary-foreground",
                isCurrent && isLost && "bg-destructive/10 text-destructive",
                // Done stages: muted success green (semantic — using emerald as nearest token)
                isDone && "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
                // Future stages: muted
                !isCurrent && !isDone && "bg-muted text-muted-foreground"
              )}
              style={{
                clipPath,
                marginRight: arrayIndex < DISPLAY_STAGES.length - 1 ? "-10px" : undefined,
                zIndex: DISPLAY_STAGES.length - arrayIndex,
              }}
              aria-current={isCurrent ? "step" : undefined}
            >
              {displayStage.label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
