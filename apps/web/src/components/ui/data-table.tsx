"use client"

import { useState, useMemo, useCallback, type ReactNode } from "react"
import { Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowUpDown } from "lucide-react"

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

export type ColumnDef<T> = {
  id: string
  label: string
  sortable?: boolean
  filterable?: boolean
  render: (item: T) => ReactNode
  cellClassName?: string
}

export type DataTableProps<T> = {
  columns: ColumnDef<T>[]
  data: T[]
  loading?: boolean
  emptyMessage?: string
  emptyGuidance?: string
  searchPlaceholder?: string
  onSearch?: (q: string) => void
  searchValue?: string
  page?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  pageSize?: number
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: number[]
  className?: string
  sortable?: boolean
  filters?: Record<string, string[]>
  onFilterChange?: (key: string, values: string[]) => void
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  loading,
  emptyMessage = "결과가 없습니다",
  emptyGuidance = "검색어나 필터를 조정해 보세요.",
  searchPlaceholder = "검색...",
  onSearch,
  searchValue,
  page,
  totalPages,
  onPageChange,
  pageSize = 20,
  onPageSizeChange,
  pageSizeOptions = [10, 20, 50, 100],
  className,
  sortable = true,
}: DataTableProps<T>) {
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc")
  const [searchInput, setSearchInput] = useState(searchValue ?? "")

  const sortedData = useMemo(() => {
    if (!sortColumn || !sortable) return data
    return [...data].sort((a, b) => {
      const aVal = a[sortColumn]
      const bVal = b[sortColumn]
      if (aVal == null) return 1
      if (bVal == null) return -1
      const cmp = String(aVal).localeCompare(String(bVal))
      return sortDirection === "asc" ? cmp : -cmp
    })
  }, [data, sortColumn, sortDirection, sortable])

  const handleSort = useCallback((col: string) => {
    setSortColumn(prev => prev === col ? prev : col)
    setSortDirection(prev => sortColumn === col && prev === "asc" ? "desc" : "asc")
  }, [sortColumn])

  const handleSearchInput = useCallback((val: string) => {
    setSearchInput(val)
    onSearch?.(val)
  }, [onSearch])

  const debounceRef = useState<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setSearchInput(val)
    if (debounceRef[0]) clearTimeout(debounceRef[0])
    const timeout = setTimeout(() => onSearch?.(val), 300)
    debounceRef[1](timeout)
  }, [onSearch, debounceRef])

  return (
    <div className={cn("space-y-3", className)}>
      {onSearch && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder={searchPlaceholder}
            value={searchInput}
            onChange={handleSearchChange}
            className="pl-8 h-8"
          />
        </div>
      )}

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.id}
                  className={cn(
                    "text-xs font-medium text-muted-foreground",
                    col.sortable && sortable && "cursor-pointer select-none hover:text-foreground",
                    col.cellClassName,
                  )}
                  onClick={() => col.sortable && sortable && handleSort(col.id)}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortable && sortColumn === col.id && (
                      sortDirection === "asc"
                        ? <ChevronUp className="h-3 w-3" />
                        : <ChevronDown className="h-3 w-3" />
                    )}
                    {col.sortable && sortable && sortColumn !== col.id && (
                      <ArrowUpDown className="h-3 w-3 opacity-30" />
                    )}
                  </div>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((col) => (
                    <TableCell key={col.id}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : sortedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-1">
                    <p className="text-sm text-muted-foreground">{emptyMessage}</p>
                    <p className="text-xs text-muted-foreground">{emptyGuidance}</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              sortedData.map((item, i) => (
                <TableRow key={(item as any).id ?? i}>
                  {columns.map((col) => (
                    <TableCell key={col.id} className={col.cellClassName}>
                      {col.render(item)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages && totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {onPageSizeChange && (
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="h-7 rounded-md border border-input bg-transparent px-2 text-xs"
              >
                {pageSizeOptions.map((s) => (
                  <option key={s} value={s}>{s} / page</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="xs"
              disabled={!page || page <= 1}
              onClick={() => onPageChange((page ?? 1) - 1)}
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <span className="px-2 text-xs tabular-nums text-muted-foreground">
              {page ?? 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="xs"
              disabled={!page || page >= totalPages}
              onClick={() => onPageChange((page ?? 1) + 1)}
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
