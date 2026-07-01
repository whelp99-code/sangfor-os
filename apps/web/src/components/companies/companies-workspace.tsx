"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Plus, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreateCustomerForm } from "@/components/customers/create-customer-form";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { stageLabel, formatKRWCompact } from "@/components/deals/stage-meta";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompanyDeal = {
  id: string;
  title: string;
  code: string | null;
  stage: string;
  amount: number | null;
};

export type Company = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  status: string;
  contacts: number;
  partners: number;
  tasks: number;
  deals: CompanyDeal[];
};

// ---------------------------------------------------------------------------
// Industry badge colors (semantic tokens only)
// ---------------------------------------------------------------------------

function IndustryBadge({ industry }: { industry: string | null }) {
  if (!industry) {
    return <Badge variant="outline">-</Badge>;
  }
  return <Badge variant="secondary">{industry}</Badge>;
}

// ---------------------------------------------------------------------------
// Deal mini-table inside the right detail panel
// ---------------------------------------------------------------------------

function DealsMiniTable({ deals }: { deals: CompanyDeal[] }) {
  if (deals.length === 0) {
    return (
      <p className="px-2 py-4 text-center text-xs text-muted-foreground">
        연결된 딜이 없습니다.
      </p>
    );
  }

  const totalAmount = deals.reduce((sum, d) => sum + (d.amount ?? 0), 0);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2 px-0.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          연결된 딜
        </span>
        <span className="text-xs text-muted-foreground">
          {deals.length}건
          {totalAmount > 0 ? ` · ${formatKRWCompact(totalAmount)}` : ""}
        </span>
      </div>
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="py-2 text-[11px]">프로젝트 ID</TableHead>
              <TableHead className="py-2 text-[11px]">딜명</TableHead>
              <TableHead className="py-2 text-[11px]">단계</TableHead>
              <TableHead className="py-2 text-right text-[11px]">공급가</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deals.map((deal) => (
              <TableRow key={deal.id}>
                <TableCell className="py-2 font-mono text-[11px] font-bold text-primary">
                  {deal.code ?? deal.id.slice(0, 12)}
                </TableCell>
                <TableCell className="max-w-[180px] truncate py-2 text-xs font-medium">
                  {deal.title}
                </TableCell>
                <TableCell className="py-2">
                  <Badge variant="outline" className="text-[10px]">
                    {stageLabel(deal.stage)}
                  </Badge>
                </TableCell>
                <TableCell className="py-2 text-right text-xs font-bold tabular-nums">
                  {deal.amount != null ? formatKRWCompact(deal.amount) : "-"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right detail panel
// ---------------------------------------------------------------------------

function CompanyDetailPanel({ company }: { company: Company }) {
  return (
    <div className="flex flex-col gap-0 rounded-xl border bg-card ring-1 ring-foreground/10">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Building2 className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            회사 · Company
          </p>
          <h2 className="truncate text-base font-bold leading-tight text-foreground">
            {company.name}
          </h2>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            href={`/customers/${company.id}#contacts`}
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-7 text-xs")}
          >
            연락처 추가
          </Link>
          <Link
            href={`/customers/${company.id}`}
            className={cn(buttonVariants({ size: "sm" }), "h-7 text-xs")}
          >
            전체 편집
          </Link>
        </div>
      </div>

      {/* Basic info section */}
      <div className="px-4 py-3">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          기본 정보
        </p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-0">
          <FieldRow label="회사명" value={company.name} />
          <FieldRow label="산업" value={company.industry ?? "-"} />
          <FieldRow label="도메인" value={company.domain ?? "-"} />
          <FieldRow label="상태" value={company.status} />
          <FieldRow label="연락처" value={String(company.contacts)} />
          <FieldRow label="파트너" value={String(company.partners)} />
        </dl>
      </div>

      {/* Connected deals section */}
      <div className="border-t px-4 py-3">
        <DealsMiniTable deals={company.deals} />
      </div>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border/40 py-2 last:border-0">
      <dt className="text-[10px] text-muted-foreground">{label}</dt>
      <dd className="text-xs font-semibold text-foreground">{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left company list table
// ---------------------------------------------------------------------------

function CompanyListTable({
  companies,
  selectedId,
  onSelect,
}: {
  companies: Company[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="py-2.5 text-[11px]">회사명</TableHead>
            <TableHead className="py-2.5 text-[11px]">산업</TableHead>
            <TableHead className="py-2.5 text-right text-[11px]">진행 딜</TableHead>
            <TableHead className="py-2.5 text-right text-[11px]">총매출</TableHead>
            <TableHead className="py-2.5 text-[11px]">상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {companies.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-8 text-center text-xs text-muted-foreground">
                고객사가 없습니다.
              </TableCell>
            </TableRow>
          ) : (
            companies.map((company) => {
              const isSelected = company.id === selectedId;
              const totalAmount = company.deals.reduce(
                (sum, d) => sum + (d.amount ?? 0),
                0
              );
              return (
                <TableRow
                  key={company.id}
                  aria-selected={isSelected}
                  onClick={() => onSelect(company.id)}
                  className={cn(
                    "cursor-pointer",
                    isSelected && "bg-primary/10 hover:bg-primary/10"
                  )}
                >
                  <TableCell className="py-2.5">
                    <div className="font-semibold text-foreground">{company.name}</div>
                    {company.domain ? (
                      <div className="text-[11px] text-muted-foreground">{company.domain}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <IndustryBadge industry={company.industry} />
                  </TableCell>
                  <TableCell className="py-2.5 text-right tabular-nums">
                    <span
                      className={cn(
                        "text-xs font-bold",
                        company.deals.length > 0 ? "text-primary" : "text-muted-foreground"
                      )}
                    >
                      {company.deals.length}
                    </span>
                  </TableCell>
                  <TableCell className="py-2.5 text-right text-xs font-bold tabular-nums">
                    {totalAmount > 0 ? formatKRWCompact(totalAmount) : "-"}
                  </TableCell>
                  <TableCell className="py-2.5">
                    <Badge variant="outline" className="text-[10px]">
                      {company.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main workspace (master-detail layout)
// ---------------------------------------------------------------------------

export function CompaniesWorkspace({ companies }: { companies: Company[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    companies[0]?.id ?? null
  );
  const [showCreate, setShowCreate] = useState(false);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === selectedId) ?? null,
    [companies, selectedId]
  );

  return (
    <div>
      {/* List header */}
      <div className="mb-3 flex items-center gap-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Building2 className="size-4" aria-hidden="true" />
        </div>
        <div className="flex items-baseline gap-2">
          <h1 className="text-lg font-bold tracking-tight">회사</h1>
          <span className="text-sm text-muted-foreground">· {companies.length}곳</span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled
            title="준비 중"
            aria-label="필터 (준비 중)"
          >
            필터
          </Button>
          <Button
            size="sm"
            className="gap-1"
            onClick={() => setShowCreate((open) => !open)}
            aria-expanded={showCreate}
          >
            {showCreate ? (
              <X className="size-3.5" aria-hidden="true" />
            ) : (
              <Plus className="size-3.5" aria-hidden="true" />
            )}
            {showCreate ? "닫기" : "새 회사"}
          </Button>
        </div>
      </div>

      {/* Inline create-company form (POST /api/customers) */}
      {showCreate ? (
        <div className="mb-3 rounded-xl border bg-card p-3 ring-1 ring-foreground/10">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            새 회사 추가
          </p>
          <CreateCustomerForm />
        </div>
      ) : null}

      {/* Master-detail two-column split */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[400px_1fr]">
        {/* Left: company list */}
        <CompanyListTable
          companies={companies}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        {/* Right: company detail */}
        <div>
          {selectedCompany ? (
            <CompanyDetailPanel company={selectedCompany} />
          ) : (
            <div className="flex h-40 items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground ring-1 ring-foreground/10">
              회사를 선택하면 상세 정보가 표시됩니다.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
