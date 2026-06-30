"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ViewSwitcher } from "@/components/views/view-switcher";
import { useCollectionView } from "@/lib/use-collection-view";
import { CreateOpportunityForm } from "@/components/opportunities/create-opportunity-form";
import { normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";

import { DealsBoard } from "@/components/deals/deals-board";
import { DealsTable } from "@/components/deals/deals-table";
import { STAGE_CHIP_GROUPS, formatKRWCompact } from "@/components/deals/stage-meta";
import { stageTransitionMessage } from "@/components/deals/stage-error";
import type { Deal } from "@/components/deals/types";
import { cn } from "@/lib/utils";

type Option = { id: string; label: string };

// ---------------------------------------------------------------------------
// Stage filter chips — sourced from STAGE_CHIP_GROUPS, which is derived ONLY
// from the Prisma OpportunityStage enum. Each chip filters on the enum values
// its group folds in. "전체" (ALL) clears the filter. This keeps the chips and
// the kanban board (deals-board, same enum) in lockstep — no RESULT/DELIVERY
// pseudo-stages that would always render empty.
// ---------------------------------------------------------------------------
type StageKey = string; // "ALL" or a chip-group label

const STAGE_CHIPS: { key: StageKey; label: string }[] = [
  { key: "ALL", label: "전체" },
  ...STAGE_CHIP_GROUPS.map((group) => ({ key: group.label, label: group.label })),
];

// Chip key (group label) → enum stage values it filters for.
const STAGE_MAP: Record<string, string[]> = {
  ALL: [],
  ...Object.fromEntries(STAGE_CHIP_GROUPS.map((group) => [group.label, group.enumValues])),
};

export function DealsWorkspace({
  deals,
  customers,
  partners,
}: {
  deals: Deal[];
  customers: Option[];
  partners: Option[];
}) {
  const { view, setView, query } = useCollectionView("table");
  const router = useRouter();
  const [items, setItems] = useState<Deal[]>(deals);
  const [showCreate, setShowCreate] = useState(false);
  const [activeStage, setActiveStage] = useState<StageKey>("ALL");
  const [moveError, setMoveError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Re-sync optimistic state when the server re-renders with fresh data.
  useEffect(() => setItems(deals), [deals]);

  const normalized = query.trim().toLowerCase();
  const queryFiltered = normalized
    ? items.filter((deal) =>
        `${deal.title} ${deal.customer ?? ""}`.toLowerCase().includes(normalized)
      )
    : items;

  const filtered =
    activeStage === "ALL"
      ? queryFiltered
      : queryFiltered.filter((deal) =>
          (STAGE_MAP[activeStage] ?? []).includes(normalizeOpportunityStage(deal.stage))
        );

  const totalCount = filtered.length;
  const totalValue = filtered.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  const weightedMargin = filtered.reduce(
    (sum, deal) =>
      sum + (deal.amount ?? 0) * ((deal.marginPct ?? 0) / 100),
    0
  );

  async function moveDeal(id: string, toStage: string) {
    const previous = items;
    setMoveError(null);
    setItems((current) =>
      current.map((deal) => (deal.id === id ? { ...deal, stage: toStage } : deal))
    );
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: toStage }),
      });
      if (!res.ok) {
        // Surface the server's rejection reason (e.g. registration gate,
        // illegal stage skip) instead of silently reverting.
        let reason = "update_failed";
        try {
          const payload = (await res.json()) as { error?: string };
          if (payload?.error) reason = payload.error;
        } catch {
          /* non-JSON error body — fall back to generic message */
        }
        setItems(previous);
        setMoveError(stageTransitionMessage(reason));
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setItems(previous);
      setMoveError(stageTransitionMessage("update_failed"));
    }
  }

  return (
    <div className="space-y-0">
      {/* ── List header ── */}
      <div className="rounded-t-lg border border-b-0 bg-card px-4 pt-3 pb-0">
        {/* Top row: icon + title + count + actions */}
        <div className="flex items-center gap-2.5">
          <div
            className="flex size-[34px] shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
            aria-hidden="true"
          >
            <Briefcase className="size-4.5" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] text-muted-foreground">프로젝트</p>
            <h1 className="flex items-center gap-2 text-lg font-extrabold leading-tight">
              전체 진행중
              <span className="text-[12px] font-bold text-primary">▾</span>
              <span className="text-[12px] font-medium text-muted-foreground">
                · {totalCount}건
              </span>
            </h1>
          </div>
          {/* Right-side toolbar */}
          <div className="ml-auto flex items-center gap-2">
            <ViewSwitcher
              value={view}
              onChange={setView}
              available={["table", "kanban"]}
            />
            <Button variant="outline" size="sm" disabled title="준비 중" aria-label="필터 (준비 중)">
              필터
            </Button>
            <Button variant="outline" size="sm" disabled title="준비 중" aria-label="열 설정 (준비 중)">
              열 설정
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setShowCreate((open) => !open)}>
              {showCreate ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
              {showCreate ? "닫기" : "+ 새 딜"}
            </Button>
          </div>
        </div>

        {/* Stage filter chips row */}
        <div className="mt-3 flex items-center gap-2 pb-3 overflow-x-auto">
          {STAGE_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setActiveStage(chip.key)}
              className={cn(
                "whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold cursor-pointer transition-colors",
                activeStage === chip.key
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-muted text-foreground/70 hover:bg-muted/80"
              )}
              aria-pressed={activeStage === chip.key}
            >
              {chip.label}
            </button>
          ))}
          {/* Totals (right-aligned) — aria-live so screen readers announce filter changes (L-2) */}
          <span
            className="ml-auto flex shrink-0 gap-3 text-[12px] text-muted-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            <span>합계 {formatKRWCompact(totalValue)}</span>
            <span>예상마진 {formatKRWCompact(weightedMargin)}</span>
          </span>
        </div>
      </div>

      {/* Stage-move failure banner — surfaces the server's block reason
          (registration gate / illegal transition) instead of a silent revert. */}
      {moveError ? (
        <div
          className="border border-t-0 border-destructive/30 bg-destructive/10 px-4 py-2.5"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start gap-2">
            <p className="text-xs font-medium text-destructive">{moveError}</p>
            <button
              type="button"
              onClick={() => setMoveError(null)}
              className="ml-auto shrink-0 text-destructive/70 hover:text-destructive"
              aria-label="알림 닫기"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ) : null}

      {/* Create form (inline, shown when toggled) */}
      {showCreate ? (
        <div className="border border-t-0 border-b-0 bg-card px-4 py-3">
          <p className="mb-3 text-sm font-medium">새 영업기회 등록</p>
          <CreateOpportunityForm customers={customers} partners={partners} />
        </div>
      ) : null}

      {/* Table / Board */}
      <div className="rounded-b-lg border border-t-0 bg-card overflow-x-auto">
        {view === "table" ? (
          <DealsTable deals={filtered} />
        ) : (
          <DealsBoard deals={filtered} onMove={moveDeal} />
        )}
      </div>

      {/* Project ID note */}
      <div
        className="mt-3.5 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-xs text-primary"
        role="note"
      >
        🔑{" "}
        <strong className="text-primary/90">Project ID = 모든 테이블의 연결 키.</strong>{" "}
        새 딜 = <strong>PRJ-2026-####</strong> 자동 발번; 제안서·PoC·입찰·수주·딜리버리·작업·문서·활동·채널등록이 이 ID로 묶임.
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {[
            "제안서",
            "PoC 평가계획·결과",
            "입찰·SPR",
            "수주·SOW",
            "딜리버리(UAT·Go-Live)",
            "작업",
            "문서",
            "활동",
            "채널·딜등록",
          ].map((tag) => (
            <span
              key={tag}
              className="rounded-md border border-primary/20 bg-card px-2 py-0.5 text-[11px] font-bold text-primary"
            >
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
