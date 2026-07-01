"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataView } from "@/components/views/data-view";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatKRW, stageDisplay } from "@/components/deals/stage-meta";
import { regStatusMeta, regStatusBadgeVariant, regStatusBadgeClassName, regStatusInlineClasses } from "@/components/deals/reg-status";
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
// RowActions — ⋯ dropdown: 편집(상세 링크) · 복사(준비 중) · 삭제(confirm→DELETE)
// ---------------------------------------------------------------------------
function RowActions({ deal }: { deal: Deal }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) return;
    if (!confirm(`"${deal.title}" 딜을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/opportunities/${deal.id}`, { method: "DELETE" });
      if (!res.ok) {
        alert("딜을 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }
      router.refresh();
    } catch {
      alert("딜을 삭제하지 못했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex size-7 items-center justify-center rounded-md p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${deal.title} 더보기`}
        onClick={(e) => e.stopPropagation()}
      >
        <MoreHorizontal className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          render={<Link href={`/deals/${deal.id}`} onClick={(e) => e.stopPropagation()} />}
        >
          편집
        </DropdownMenuItem>
        <DropdownMenuItem disabled>복사 (준비 중)</DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={deleting}
          onSelect={(e) => {
            e.preventDefault();
            void handleDelete();
          }}
        >
          {deleting ? "삭제 중..." : "삭제"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Binding columns — mockup order: select · PID · 딜/고객사 · 총판 · 제품군 ·
//   단계 · 공급가 · 마진% · 딜등록 · 다음액션 · 담당 · 마감 · ⋯
// ---------------------------------------------------------------------------
const columns: ColumnDef<Deal, unknown>[] = [
  // 0. Row-select checkbox (H-6) — visual placeholder; full selection state lives in DataView
  {
    id: "select",
    enableSorting: false,
    size: 40,
    header: () => (
      <input
        type="checkbox"
        aria-label="전체 선택"
        className="size-3.5 cursor-pointer accent-primary"
        readOnly
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        aria-label={`${row.original.title} 선택`}
        className="size-3.5 cursor-pointer accent-primary"
        readOnly
        onClick={(e) => e.stopPropagation()}
      />
    ),
  },
  // 1. Project ID
  {
    accessorKey: "code",
    header: "프로젝트 ID",
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
      const meta = regStatusMeta(row.original.regStatus, row.original.protectionExpiresAt);
      if (meta.tone === "muted") {
        return <span className={cn("text-xs", regStatusInlineClasses("muted"))}>미등록</span>;
      }
      return (
        <Badge
          variant={regStatusBadgeVariant(meta.tone)}
          className={cn("text-xs", regStatusBadgeClassName(meta.tone))}
        >
          {meta.label}
        </Badge>
      );
    },
  },
  // 9. 다음 액션 — BEFORE 담당·마감 (H-5)
  {
    accessorKey: "nextAction",
    header: "다음 액션",
    cell: ({ row }) => (
      <span className="line-clamp-1 text-sm text-muted-foreground">
        {row.original.nextAction ?? "미정"}
      </span>
    ),
  },
  // 10. 담당
  {
    accessorKey: "owner",
    header: "담당",
    cell: ({ row }) => row.original.owner ?? "—",
  },
  // 11. 마감
  {
    accessorKey: "closeDate",
    header: "마감",
    cell: ({ row }) =>
      row.original.closeDate
        ? new Date(row.original.closeDate).toLocaleDateString("ko-KR")
        : "—",
  },
  // 12. Row actions ⋯ (H-6)
  {
    id: "actions",
    enableSorting: false,
    header: () => null,
    cell: ({ row }) => <RowActions deal={row.original} />,
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
