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
        label: "Name",
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
        label: "Domain",
        sortable: true,
        render: (item) => (
          <span className="text-muted-foreground">{item.domain ?? "—"}</span>
        ),
      },
      {
        id: "status",
        label: "Status",
        sortable: true,
        render: (item) => <Badge variant="outline">{item.status}</Badge>,
      },
      {
        id: "partners",
        label: "Partners",
        sortable: false,
        render: (item) => (
          <span className="text-muted-foreground">
            {item.partnerLinks.length}
          </span>
        ),
      },
      {
        id: "tasks",
        label: "Tasks",
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
            Open
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
      searchPlaceholder="Search customers..."
      searchValue={search}
      onSearch={setSearch}
      emptyMessage="No customers found"
      emptyGuidance={
        searchQuery
          ? `No results for "${searchQuery}". Try a different search term.`
          : "No customers yet. Create one to get started."
      }
    />
  )
}
