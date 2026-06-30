"use client";

import { useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { DataView } from "@/components/views/data-view";

export type ContactRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  customerId: string | null;
};

const columns: ColumnDef<ContactRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "이름",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "role",
    header: "역할",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.role ?? "—"}</span>
    ),
  },
  {
    accessorKey: "email",
    header: "이메일",
    cell: ({ row }) =>
      row.original.email ? (
        <a
          href={`mailto:${row.original.email}`}
          className="text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.email}
        </a>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
  {
    accessorKey: "phone",
    header: "전화",
    cell: ({ row }) => (
      <span className="text-muted-foreground tabular-nums">{row.original.phone ?? "—"}</span>
    ),
  },
  {
    accessorKey: "company",
    header: "회사",
    cell: ({ row }) =>
      row.original.customerId ? (
        <Link
          href={`/customers/${row.original.customerId}`}
          className="hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.company}
        </Link>
      ) : (
        <span className="text-muted-foreground">{row.original.company ?? "—"}</span>
      ),
  },
];

export function ContactsTable({ contacts }: { contacts: ContactRow[] }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const filtered = normalized
    ? contacts.filter((contact) =>
        `${contact.name} ${contact.email ?? ""} ${contact.company ?? ""} ${contact.role ?? ""}`
          .toLowerCase()
          .includes(normalized)
      )
    : contacts;

  return (
    <div className="space-y-4">
      <div className="relative max-w-xs">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="연락처 검색…"
          aria-label="연락처 검색"
          className="h-8 pl-8"
        />
      </div>
      <DataView<ContactRow>
        columns={columns}
        data={filtered}
        rowHref={(contact) =>
          contact.customerId ? `/customers/${contact.customerId}` : "/contacts"
        }
        emptyTitle="연락처가 없습니다"
        emptyDescription="고객사 상세에서 연락처를 추가하면 여기에 모여 표시됩니다."
      />
    </div>
  );
}
