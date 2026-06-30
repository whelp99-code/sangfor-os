"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Settings2, SlidersHorizontal, Users } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { DataView } from "@/components/views/data-view";
import { cn } from "@/lib/utils";

export type ContactRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  customerId: string | null;
};

// ---- Role badge helpers ------------------------------------------------

const ROLE_CHIP_FILTERS = [
  { label: "전체", value: "" },
  { label: "Economic Buyer", value: "economic buyer" },
  { label: "Champion", value: "champion" },
  { label: "기술", value: "기술" },
  { label: "구매", value: "구매" },
] as const;

function resolveRoleTone(role: string): "economic-buyer" | "champion" | "muted" {
  const r = role.toLowerCase();
  if (r.includes("economic") || r.includes("buyer")) return "economic-buyer";
  if (r.includes("champion")) return "champion";
  return "muted";
}

function RoleBadge({ role }: { role: string | null }) {
  if (!role) return <span className="text-muted-foreground">—</span>;

  const tone = resolveRoleTone(role);

  if (tone === "economic-buyer") {
    return (
      <Badge
        className="border-blue-agent-border bg-blue-agent-bg text-blue-agent"
        variant="outline"
      >
        {role}
      </Badge>
    );
  }

  if (tone === "champion") {
    return (
      <Badge
        className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300"
        variant="outline"
      >
        {role}
      </Badge>
    );
  }

  // muted: 기술 / 구매 / other
  return <Badge variant="secondary">{role}</Badge>;
}

// ---- Column definitions -----------------------------------------------

const columns: ColumnDef<ContactRow, unknown>[] = [
  {
    accessorKey: "name",
    header: "이름",
    cell: ({ row }) => (
      <span className="font-semibold text-foreground">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "company",
    header: "회사",
    cell: ({ row }) =>
      row.original.customerId ? (
        <Link
          href={`/customers/${row.original.customerId}`}
          className="text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.company}
        </Link>
      ) : (
        <span className="text-muted-foreground">{row.original.company ?? "—"}</span>
      ),
  },
  {
    accessorKey: "role",
    header: "역할",
    cell: ({ row }) => <RoleBadge role={row.original.role} />,
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
      <span className="tabular-nums text-muted-foreground">{row.original.phone ?? "—"}</span>
    ),
  },
];

// ---- Main component ---------------------------------------------------

export function ContactsTable({ contacts }: { contacts: ContactRow[] }) {
  const [activeFilter, setActiveFilter] = useState<string>("");

  const filtered =
    activeFilter === ""
      ? contacts
      : contacts.filter((c) => {
          const role = (c.role ?? "").toLowerCase();
          return role.includes(activeFilter);
        });

  return (
    <div className="space-y-0">
      {/* List header — matches mockup 12 .lh pattern */}
      <div className="rounded-t-xl border border-b-0 bg-card px-4 py-3">
        {/* Top row: icon + title + count + actions */}
        <div className="flex items-center gap-3">
          <div
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"
          >
            <Users className="size-4" aria-hidden="true" />
          </div>
          <h1 className="text-lg font-bold tracking-tight text-foreground">
            연락처
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              · {contacts.length}명
            </span>
          </h1>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" disabled title="준비 중">
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              필터
            </Button>
            <Button variant="outline" size="sm" disabled title="준비 중">
              <Settings2 className="size-3.5" aria-hidden="true" />
              열 설정
            </Button>
            <Link
              href="/customers"
              title="고객사 상세에서 연락처를 추가합니다"
              className={buttonVariants({ size: "sm" })}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              새 연락처
            </Link>
          </div>
        </div>

        {/* Filter chips */}
        <div
          className="mt-3 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="역할 필터"
        >
          {ROLE_CHIP_FILTERS.map((chip) => {
            const isActive = activeFilter === chip.value;
            return (
              <button
                key={chip.value}
                type="button"
                onClick={() => setActiveFilter(chip.value)}
                aria-pressed={isActive}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
                  isActive
                    ? "border-blue-agent-border bg-blue-agent-bg text-blue-agent"
                    : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {chip.label}
              </button>
            );
          })}
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length}명 표시 중
          </span>
        </div>
      </div>

      {/* Table — rounded-b only; top border is handled by the header panel */}
      <div className="[&>div]:rounded-t-none [&>div]:border-t-0">
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
    </div>
  );
}
