"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";

import { DataView } from "@/components/views/data-view";
import { Badge } from "@/components/ui/badge";
import { formatKRW, stageLabel } from "@/components/deals/stage-meta";
import type { Deal } from "@/components/deals/types";

const columns: ColumnDef<Deal, unknown>[] = [
  {
    accessorKey: "title",
    header: "딜",
    cell: ({ row }) => <span className="font-medium">{row.original.title}</span>,
  },
  {
    accessorKey: "customer",
    header: "채널",
    cell: ({ row }) => (
      <div className="space-y-0.5">
        <p className="font-medium">{row.original.customer ?? "고객 미지정"}</p>
        <p className="text-xs text-muted-foreground">
          {row.original.partner ? `파트너 · ${row.original.partner}` : "파트너 미지정"}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "stage",
    header: "단계",
    cell: ({ row }) => (
      <Badge variant="secondary">{stageLabel(normalizeOpportunityStage(row.original.stage))}</Badge>
    ),
  },
  {
    accessorKey: "amount",
    header: "금액",
    cell: ({ row }) =>
      row.original.amount != null ? (
        <span className="tabular-nums">{formatKRW(row.original.amount)}</span>
      ) : (
        "—"
      ),
  },
  {
    accessorKey: "probability",
    header: "확률",
    cell: ({ row }) => <span className="tabular-nums">{row.original.probability}%</span>,
  },
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
      rowHref={(deal) => `/opportunities/${deal.id}`}
      emptyTitle="딜이 없습니다"
      emptyDescription="새 딜을 등록하면 여기에 표시됩니다."
    />
  );
}
