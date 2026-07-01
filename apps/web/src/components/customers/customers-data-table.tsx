"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { DataTable, type ColumnDef } from "@/components/ui/data-table"

type CustomerRecord = {
  id: string
  name: string
  domain: string | null
  status: string
  partnerLinks: { partner: { name: string } }[]
  _count: { workTasks: number }
}

type Props = {
  customers: CustomerRecord[]
  searchQuery: string | null
}

export function CustomersDataTable({ customers, searchQuery }: Props) {
  const [search, setSearch] = useState(searchQuery ?? "")

  const filtered = useMemo(() => {
    if (!search) return customers
    const q = search.toLowerCase()
    return customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.domain && c.domain.toLowerCase().includes(q)),
    )
  }, [customers, search])

  const columns: ColumnDef<CustomerRecord>[] = useMemo(
    () => [
      {
        id: "name",
        label: "고객사",
        sortable: true,
        filterable: true,
        render: (item) => (
          <Link
            href={`/customers/${item.id}`}
            className="font-medium hover:underline"
          >
            {item.name}
          </Link>
        ),
      },
      {
        id: "domain",
        label: "도메인",
        sortable: true,
        render: (item) => (
          <span className="text-muted-foreground">{item.domain ?? "—"}</span>
        ),
      },
      {
        id: "status",
        label: "상태",
        sortable: true,
        render: (item) => <Badge variant="outline">{item.status}</Badge>,
      },
      {
        id: "partners",
        label: "파트너",
        sortable: false,
        render: (item) => (
          <span className="text-muted-foreground">
            {item.partnerLinks.length}
          </span>
        ),
      },
      {
        id: "tasks",
        label: "작업",
        sortable: true,
        render: (item) => (
          <span className="text-muted-foreground">{item._count.workTasks}</span>
        ),
      },
      {
        id: "actions",
        label: "",
        sortable: false,
        cellClassName: "w-0",
        render: (item) => (
          <Link
            href={`/customers/${item.id}`}
            className="text-xs text-primary hover:underline"
          >
            열기
          </Link>
        ),
      },
    ],
    [],
  )

  return (
    <DataTable
      columns={columns}
      data={filtered}
      searchPlaceholder="고객사 검색..."
      searchValue={search}
      onSearch={setSearch}
      emptyMessage="고객사가 없습니다"
      emptyGuidance={
        searchQuery
          ? `"${searchQuery}"에 대한 결과가 없습니다. 다른 검색어를 입력해 보세요.`
          : "첫 고객사를 추가해 시작하세요."
      }
    />
  )
}
