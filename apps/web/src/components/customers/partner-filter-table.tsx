"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type PartnerKind = "VENDOR" | "DISTRIBUTOR" | "RESELLER";

type Contact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
};

type Partner = {
  id: string;
  name: string;
  partnerType: string | null;
  kind: PartnerKind | null;
  status: string;
  customerLinks: { id: string }[];
  contacts: Contact[];
  _count: { contacts: number; opportunities: number };
};

type FilterChip = "all" | "distributor" | "reseller" | "vendor";

const FILTER_LABELS: Record<FilterChip, string> = {
  all: "전체",
  distributor: "총판",
  reseller: "파트너",
  vendor: "벤더",
};

function kindToFilter(kind: PartnerKind | null): Exclude<FilterChip, "all"> {
  if (kind === "DISTRIBUTOR") return "distributor";
  if (kind === "RESELLER") return "reseller";
  if (kind === "VENDOR") return "vendor";
  return "reseller";
}

function KindBadge({ kind }: { kind: PartnerKind | null }) {
  if (kind === null) return <span className="text-muted-foreground">—</span>;

  const map: Record<PartnerKind, { label: string; variant: "secondary" | "outline" | "default" | "destructive" }> = {
    DISTRIBUTOR: { label: "총판", variant: "secondary" },
    RESELLER: { label: "파트너", variant: "outline" },
    VENDOR: { label: "벤더", variant: "default" },
  };

  const { label, variant } = map[kind];

  return <Badge variant={variant}>{label}</Badge>;
}

function formatRevenue(count: number): string {
  if (count === 0) return "—";
  return `${count}건`;
}

interface PartnerFilterTableProps {
  partners: Partner[];
  total: number;
}

export function PartnerFilterTable({ partners, total }: PartnerFilterTableProps) {
  const [activeFilter, setActiveFilter] = useState<FilterChip>("all");

  const filtered =
    activeFilter === "all"
      ? partners
      : partners.filter((p) => kindToFilter(p.kind) === activeFilter);

  return (
    <div>
      {/* List header */}
      <div className="rounded-t-lg border border-b-0 bg-card px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-xl" aria-hidden="true">🤝</span>
          <div>
            <h1 className="text-lg font-extrabold flex items-center gap-2">
              총판 · 파트너
              <span className="text-sm font-medium text-muted-foreground">· {total}곳</span>
            </h1>
          </div>
        </div>

        {/* Filter chips + count */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(["all", "distributor", "reseller", "vendor"] as FilterChip[]).map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setActiveFilter(chip)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                activeFilter === chip
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border bg-muted text-muted-foreground hover:bg-muted/80",
              )}
              aria-pressed={activeFilter === chip}
            >
              {FILTER_LABELS[chip]}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">총 {filtered.length}개 채널사</span>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-b-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>구분</TableHead>
              <TableHead className="text-right">진행 딜</TableHead>
              <TableHead className="text-right">누적 매출</TableHead>
              <TableHead>주 연락처</TableHead>
              <TableHead>비고</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-8">
                  등록된 채널사가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((partner) => {
                const primaryContact = partner.contacts[0] ?? null;
                const dealCount = partner._count.opportunities;
                const linkCount = partner.customerLinks.length;
                const displayCount = dealCount > 0 ? dealCount : linkCount > 0 ? linkCount : 0;

                return (
                  <TableRow key={partner.id}>
                    {/* 이름 */}
                    <TableCell>
                      <div className="font-bold text-foreground">{partner.name}</div>
                      {partner.partnerType && (
                        <div className="text-xs text-muted-foreground mt-0.5">{partner.partnerType}</div>
                      )}
                    </TableCell>

                    {/* 구분 */}
                    <TableCell>
                      <KindBadge kind={partner.kind} />
                    </TableCell>

                    {/* 진행 딜 */}
                    <TableCell className="text-right font-bold tabular-nums">
                      {displayCount > 0 ? displayCount : <span className="text-muted-foreground font-normal">—</span>}
                    </TableCell>

                    {/* 누적 매출 */}
                    <TableCell className="text-right text-muted-foreground">
                      —
                    </TableCell>

                    {/* 주 연락처 */}
                    <TableCell>
                      {primaryContact ? (
                        <>
                          <div className="font-bold text-foreground">{primaryContact.name}</div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {primaryContact.phone ?? primaryContact.email ?? "—"}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>

                    {/* 비고 */}
                    <TableCell className="text-sm text-muted-foreground">
                      {partner.kind === "DISTRIBUTOR" ? "딜등록 대행 · SPR 제출 담당" : ""}
                    </TableCell>
                  </TableRow>
                );
              })
            )}

            {/* Info notice row (matches mockup) */}
            <TableRow>
              <TableCell
                colSpan={6}
                className="bg-primary/5 border-t border-primary/20 text-primary/80 text-xs py-3"
              >
                딜 등록은 총판이 대행 — 총판별 진행 딜·딜등록 상태를 여기서 추적. 파트너는 레퍼럴·컨설팅 역할로 직접 딜등록 불가.
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
