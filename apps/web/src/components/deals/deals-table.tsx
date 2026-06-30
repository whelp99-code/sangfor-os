"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { DataView } from "@/components/views/data-view";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatKRW, stageDisplay } from "@/components/deals/stage-meta";
import { regStatusMeta, regStatusBadgeVariant, regStatusInlineClasses } from "@/components/deals/reg-status";
import type { Deal } from "@/components/deals/types";

// ---------------------------------------------------------------------------
// StageCell — 6 mini pips + display label + optional 패배 badge
// ---------------------------------------------------------------------------
const TOTAL_PIPS = 6;

function StageCell({ deal }: { deal: Deal }) {
  const { idx, label } = stageDisplay(deal.stage);
  const isLost = deal.dealStatus === "LOST";

  return (
    <div className={cn("flex items-center gap-2", isLost && "opacity-60")}>
      {/* mini pip track */}
      <div className="flex items-center gap-0.5" aria-hidden>
        {Array.from({ length: TOTAL_PIPS }, (_, i) => {
          const pipNum = i + 1;
          const isCurrent = pipNum === idx;
          const isFilled = pipNum < idx;
          return (
            <span
              key={i}
              className={cn(
                "h-2 w-2 rounded-full",
                isFilled && "bg-primary/40",
                isCurrent && "bg-primary ring-2 ring-primary/30",
                !isFilled && !isCurrent && "bg-muted"
              )}
            />
          );
        })}
      </div>
      {/* display label */}
      <span className="text-xs font-semibold text-primary">{label}</span>
      {/* LOST badge — orthogonal to stage */}
      {isLost && (
        <Badge variant="destructive" className="ml-1">
          패배
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Binding columns — layout contract §3 order
// ---------------------------------------------------------------------------
const columns: ColumnDef<Deal, unknown>[] = [
  // 1. Project ID
  {
    accessorKey: "code",
    header: "Project ID",
    cell: ({ row }) =>
      row.original.code ? (
        <span className="font-mono text-xs font-semibold text-primary">
          {row.original.code}
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  // 2. 딜 / 고객사
  {
    accessorKey: "title",
    header: "딜 / 고객사",
    cell: ({ row }) => (
      <div>
        <p className="font-medium leading-tight">{row.original.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {row.original.customer ?? "고객 미지정"}
        </p>
      </div>
    ),
  },
  // 3. 총판
  {
    accessorKey: "partner",
    header: "총판",
    cell: ({ row }) => row.original.partner ?? "—",
  },
  // 4. 제품군
  {
    accessorKey: "productLine",
    header: "제품군",
    cell: ({ row }) => row.original.productLine ?? "—",
  },
  // 5. 단계
  {
    accessorKey: "stage",
    header: "단계",
    cell: ({ row }) => <StageCell deal={row.original} />,
  },
  // 6. 공급가
  {
    accessorKey: "amount",
    header: "공급가",
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.amount != null ? (
        <span className="tabular-nums">{formatKRW(row.original.amount)}</span>
      ) : (
        "—"
      ),
  },
  // 7. 마진%
  {
    accessorKey: "marginPct",
    header: "마진%",
    meta: { align: "right" },
    cell: ({ row }) =>
      row.original.marginPct != null ? (
        <span className="tabular-nums text-muted-foreground">
          {row.original.marginPct}%
        </span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  // 8. 딜등록
  {
    accessorKey: "regStatus",
    header: "딜등록",
    cell: ({ row }) => {
      const meta = regStatusMeta(row.original.regStatus);
      if (meta.tone === "muted") {
        return <span className={cn("text-xs", regStatusInlineClasses("muted"))}>미등록</span>;
      }
      return (
        <Badge variant={regStatusBadgeVariant(meta.tone)} className="text-xs">
          {meta.label}
        </Badge>
      );
    },
  },
  // 9. 담당
  {
    accessorKey: "owner",
    header: "담당",
    cell: ({ row }) => row.original.owner ?? "—",
  },
  // 10. 마감
  {
    accessorKey: "closeDate",
    header: "마감",
    cell: ({ row }) =>
      row.original.closeDate
        ? new Date(row.original.closeDate).toLocaleDateString("ko-KR")
        : "—",
  },
  // 11. 다음 액션
  {
    accessorKey: "nextAction",
    header: "다음 액션",
    cell: ({ row }) => (
      <span className="line-clamp-1 text-sm text-muted-foreground">
        {row.original.nextAction ?? "미정"}
      </span>
    ),
  },
];

export function DealsTable({ deals }: { deals: Deal[] }) {
  return (
    <DataView<Deal>
      columns={columns}
      data={deals}
      rowHref={(deal) => `/deals/${deal.id}`}
      emptyTitle="딜이 없습니다"
      emptyDescription="새 딜을 등록하면 여기에 표시됩니다."
    />
  );
}
