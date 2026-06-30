"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ViewSwitcher } from "@/components/views/view-switcher";
import { useCollectionView } from "@/lib/use-collection-view";
import { CreateOpportunityForm } from "@/components/opportunities/create-opportunity-form";
import { DealsBoard } from "@/components/deals/deals-board";
import { DealsTable } from "@/components/deals/deals-table";
import { DealStagePath } from "@/components/deals/deal-record-header";
import { formatKRWCompact, stageLabel } from "@/components/deals/stage-meta";
import type { Deal } from "@/components/deals/types";

type Option = { id: string; label: string };

export function DealsWorkspace({
  deals,
  customers,
  partners,
}: {
  deals: Deal[];
  customers: Option[];
  partners: Option[];
}) {
  const { view, setView, query, setQuery } = useCollectionView("kanban");
  const router = useRouter();
  const [items, setItems] = useState<Deal[]>(deals);
  const [showCreate, setShowCreate] = useState(false);
  const [, startTransition] = useTransition();

  // Re-sync optimistic state when the server re-renders with fresh data.
  useEffect(() => setItems(deals), [deals]);

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? items.filter((deal) =>
        `${deal.title} ${deal.customer ?? ""}`.toLowerCase().includes(normalized)
      )
    : items;

  const openCount = filtered.length;
  const openValue = filtered.reduce((sum, deal) => sum + (deal.amount ?? 0), 0);
  const focusDeal = filtered.find((deal) => deal.nextAction) ?? filtered[0] ?? null;

  async function moveDeal(id: string, toStage: string) {
    const previous = items;
    setItems((current) =>
      current.map((deal) => (deal.id === id ? { ...deal, stage: toStage } : deal))
    );
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: toStage }),
      });
      if (!res.ok) throw new Error("update_failed");
      startTransition(() => router.refresh());
    } catch {
      setItems(previous);
    }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              파트너 허브 · 딜 워크스페이스
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">전체 진행중</h2>
              <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">
                {openCount}건
              </span>
              <span className="text-sm font-medium text-muted-foreground">
                파이프라인 {formatKRWCompact(openValue)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              <span className="rounded-full border bg-muted px-3 py-1">Sangfor</span>
              <span className="text-muted-foreground">→</span>
              <span className="rounded-full border bg-sky-50 px-3 py-1 text-sky-800 dark:bg-sky-950 dark:text-sky-200">
                총판·파트너
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="rounded-full border bg-emerald-50 px-3 py-1 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
                고객사
              </span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                딜 등록 보드 연동
              </span>
            </div>
          </div>
          <dl className="grid min-w-[280px] grid-cols-2 gap-3 text-sm">
            <div className="rounded-md border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">포커스 딜</dt>
              <dd className="mt-1 truncate font-semibold">{focusDeal?.title ?? "딜 없음"}</dd>
            </div>
            <div className="rounded-md border bg-muted/40 p-3">
              <dt className="text-xs text-muted-foreground">현재 단계</dt>
              <dd className="mt-1 font-semibold">
                {focusDeal ? stageLabel(focusDeal.stage) : "—"}
              </dd>
            </div>
          </dl>
        </div>
        {focusDeal ? <DealStagePath stage={focusDeal.stage} className="mt-4" /> : null}
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value || null)}
            placeholder="딜 · 고객 검색…"
            aria-label="딜 검색"
            className="h-8 pl-8"
          />
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {openCount}건 · {formatKRWCompact(openValue)}
        </span>
        <ViewSwitcher
          value={view}
          onChange={setView}
          available={["kanban", "table"]}
          className="ml-auto"
        />
        <Button size="sm" className="gap-1.5" onClick={() => setShowCreate((open) => !open)}>
          {showCreate ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          {showCreate ? "닫기" : "새 딜"}
        </Button>
      </div>

      {showCreate ? (
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-3 text-sm font-medium">새 영업기회 등록</p>
          <CreateOpportunityForm customers={customers} partners={partners} />
        </div>
      ) : null}

      {view === "table" ? <DealsTable deals={filtered} /> : <DealsBoard deals={filtered} onMove={moveDeal} />}
    </div>
  );
}
