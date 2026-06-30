"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataView } from "@/components/views/data-view";
import { CreateCustomerForm } from "@/components/customers/create-customer-form";
import { CustomerHubSummary } from "@/components/companies/customer-hub-header";

export type Company = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  status: string;
  contacts: number;
  partners: number;
  tasks: number;
};

const columns: ColumnDef<Company, unknown>[] = [
  {
    accessorKey: "name",
    header: "회사",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "domain",
    header: "도메인",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.domain ?? "—"}</span>
    ),
  },
  {
    accessorKey: "industry",
    header: "산업",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.industry ?? "—"}</span>
    ),
  },
  {
    accessorKey: "status",
    header: "상태",
    cell: ({ row }) => <Badge variant="outline">{row.original.status}</Badge>,
  },
  {
    accessorKey: "contacts",
    header: "연락처",
    cell: ({ row }) => <span className="tabular-nums">{row.original.contacts}</span>,
  },
  {
    accessorKey: "tasks",
    header: "작업",
    cell: ({ row }) => <span className="tabular-nums">{row.original.tasks}</span>,
  },
];

export function CompaniesWorkspace({ companies }: { companies: Company[] }) {
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? companies.filter((company) =>
        `${company.name} ${company.domain ?? ""} ${company.industry ?? ""}`
          .toLowerCase()
          .includes(normalized)
      )
    : companies;

  return (
    <div className="space-y-4">
      <CustomerHubSummary companies={filtered} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="회사 검색…"
            aria-label="회사 검색"
            className="h-8 pl-8"
          />
        </div>
        <span className="hidden text-xs text-muted-foreground sm:inline">{filtered.length}개</span>
        <Button size="sm" className="ml-auto gap-1.5" onClick={() => setShowCreate((open) => !open)}>
          {showCreate ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
          {showCreate ? "닫기" : "새 고객"}
        </Button>
      </div>

      {showCreate ? (
        <div className="rounded-xl border bg-card p-4">
          <p className="mb-3 text-sm font-medium">새 고객사 등록</p>
          <CreateCustomerForm />
        </div>
      ) : null}

      <DataView<Company>
        columns={columns}
        data={filtered}
        rowHref={(company) => `/customers/${company.id}`}
        emptyTitle="고객사가 없습니다"
        emptyDescription="새 고객을 등록하면 여기에 표시됩니다."
      />
    </div>
  );
}
