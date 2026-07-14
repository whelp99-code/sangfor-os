"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { cn } from "@/lib/utils";

export type DataViewProps<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  globalFilter?: string;
  rowHref?: (row: T) => string;
  emptyTitle?: string;
  emptyDescription?: string;
  /**
   * 좁은 폭에서 표 대신 쓸 카드. 주면 md 미만에서 카드로 리플로우하고 표는 숨긴다.
   * 안 주면 기존대로 표만 렌더한다(다른 컬렉션 동작 불변).
   */
  renderCard?: (row: T) => ReactNode;
};

/**
 * Generic TanStack-powered table view: sortable headers, optional global
 * filter, and clickable rows that navigate to a record. Shared by every
 * collection's "table" view.
 */
export function DataView<T>({
  columns,
  data,
  globalFilter,
  rowHref,
  emptyTitle = "결과가 없습니다",
  emptyDescription,
  renderCard,
}: DataViewProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const router = useRouter();

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter: globalFilter ?? "" },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = table.getRowModel().rows;

  const cards = renderCard ? (
    <div className="flex flex-col gap-2 md:hidden">
      {rows.map((row) => {
        const card = (
          <div className="rounded-xl border bg-card p-3.5 transition-colors hover:bg-accent/40">
            {renderCard(row.original)}
          </div>
        );
        return rowHref ? (
          <Link
            key={row.id}
            href={rowHref(row.original)}
            className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {card}
          </Link>
        ) : (
          <div key={row.id}>{card}</div>
        );
      })}
    </div>
  ) : null;

  return (
    <div
      className={cn(
        renderCard
          ? "md:overflow-hidden md:rounded-xl md:border"
          : "overflow-hidden rounded-xl border",
      )}
    >
      {cards}
      <div className={cn("overflow-x-auto", renderCard && "hidden md:block")}>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "text-xs font-medium text-muted-foreground",
                        sortable && "cursor-pointer select-none hover:text-foreground"
                      )}
                      onClick={sortable ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortable ? (
                          sorted === "asc" ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-30" />
                          )
                        ) : null}
                      </span>
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.id}
                className={cn(
                  rowHref &&
                    "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                )}
                role={rowHref ? "link" : undefined}
                tabIndex={rowHref ? 0 : undefined}
                onClick={rowHref ? () => router.push(rowHref(row.original)) : undefined}
                onKeyDown={
                  rowHref
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          router.push(rowHref(row.original));
                        }
                      }
                    : undefined
                }
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {rows.length === 0 ? (
        <EmptyState inline title={emptyTitle} description={emptyDescription} />
      ) : null}
    </div>
  );
}
