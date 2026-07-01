import Link from "next/link";
import { FileSpreadsheet, ShieldCheck, Swords, PlusCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  regStatusMeta,
  regStatusBadgeVariant,
} from "@/components/deals/reg-status";
import { formatDate } from "@/lib/format-date";
import { formatKRWShort } from "@/lib/format-krw";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal quote shape — Decimal fields serialised to string in the page. */
export type QuoteSummary = {
  id: string;
  status: string;
  version: number;
  totalRevenue: string;
  marginPct: string;
  createdAt: Date | string;
};

export type BidWorkPanelProps = {
  opportunityId: string;
  quotes: QuoteSummary[];
  /** dealRegistration.sprStatus — free-form string or null. */
  sprStatus: string | null;
  /** Channel chain: distributor name between "나" and "Sangfor". */
  distributorName: string | null;
  /** Competitor names pulled from deal detail (may be empty). */
  competitors: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QUOTE_STATUS_LABEL: Record<string, string> = {
  draft: "초안",
  ready_for_approval: "승인 요청",
  approved: "승인",
  rejected: "반려",
};

const QUOTE_STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  ready_for_approval: "secondary",
  approved: "default",
  rejected: "destructive",
};

function formatAmount(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return formatKRWShort(num);
}

/**
 * Map a free-form SPR status string to a regStatusMeta-compatible key.
 *
 * The DB stores sprStatus as a free-form string (e.g. "검토중", "SUBMITTED",
 * "승인"). We normalise common patterns to the DealRegistration regStatus enum
 * values so regStatusMeta can render the correct badge.
 */
function normaliseSprStatus(raw: string | null): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase().trim();
  if (upper === "SUBMITTED" || upper === "검토중") return "SUBMITTED";
  if (upper === "APPROVED" || upper === "승인") return "APPROVED";
  if (upper === "REJECTED" || upper === "반려" || upper === "거절") return "REJECTED";
  if (upper === "EXPIRED" || upper === "만료") return "EXPIRED";
  if (upper === "CONTESTED" || upper === "충돌") return "CONTESTED";
  if (upper === "NOT_SUBMITTED" || upper === "미등록") return "NOT_SUBMITTED";
  // Unrecognised — surface as-is via label only
  return raw;
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

/** ① 입찰 — quote list or empty state. */
function BidQuotesSection({
  opportunityId,
  quotes,
}: {
  opportunityId: string;
  quotes: QuoteSummary[];
}) {
  return (
    <section aria-labelledby="bid-quotes-heading">
      <div className="flex items-center justify-between pb-3">
        <div className="flex items-center gap-2">
          <FileSpreadsheet className="size-4 text-muted-foreground" aria-hidden="true" />
          <h3 id="bid-quotes-heading" className="text-sm font-bold">
            입찰
          </h3>
          {quotes.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {quotes.length}건
            </Badge>
          )}
        </div>
        <Link
          href={`/approvals?opportunityId=${opportunityId}`}
          className={cn(
            buttonVariants({ size: "sm", variant: "outline" }),
            "gap-1.5 text-xs"
          )}
        >
          <PlusCircle className="size-3.5" aria-hidden="true" />
          견적서 보기
        </Link>
      </div>

      {quotes.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <FileSpreadsheet
              className="mx-auto mb-2 size-8 opacity-40"
              aria-hidden="true"
            />
            <p>이 딜에 연결된 견적서가 없습니다.</p>
            <p className="mt-1">
              <Link
                href="/approvals"
                className="text-primary underline-offset-4 hover:underline"
              >
                승인 페이지에서 견적을 확인하거나 생성하세요.
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="px-3 py-2.5 text-left font-semibold">견적 번호</th>
                <th className="px-3 py-2.5 text-left font-semibold">버전</th>
                <th className="px-3 py-2.5 text-right font-semibold">금액</th>
                <th className="px-3 py-2.5 text-right font-semibold">마진</th>
                <th className="px-3 py-2.5 text-left font-semibold">상태</th>
                <th className="px-3 py-2.5 text-left font-semibold">생성일</th>
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => {
                const statusLabel = QUOTE_STATUS_LABEL[q.status] ?? q.status;
                const statusVariant =
                  QUOTE_STATUS_VARIANT[q.status] ?? "outline";
                return (
                  <tr
                    key={q.id}
                    className="border-b last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-3 py-2.5 font-mono text-xs font-bold text-primary">
                      {q.id.slice(-8).toUpperCase()}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      v{q.version}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {formatAmount(q.totalRevenue)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                      {Number(q.marginPct).toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5">
                      <Badge variant={statusVariant} className="text-xs">
                        {statusLabel}
                      </Badge>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {formatDate(q.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** ② 특별가(SPR) — channel chain + regStatusMeta badge. */
function SprSection({
  sprStatus,
  distributorName,
}: {
  sprStatus: string | null;
  distributorName: string | null;
}) {
  const normalised = normaliseSprStatus(sprStatus);
  const meta = regStatusMeta(normalised);
  const variant = regStatusBadgeVariant(meta.tone);
  const distributorLabel = distributorName ?? "총판";

  return (
    <section aria-labelledby="spr-heading">
      <div className="flex items-center gap-2 pb-3">
        <ShieldCheck className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id="spr-heading" className="text-sm font-bold">
          특별가(SPR) 요청
        </h3>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4 space-y-4">
          {/* Channel chain: 나 → 총판 → Sangfor */}
          <div
            className="flex flex-wrap items-center gap-2 text-xs font-bold"
            aria-label="채널 체인: 나에서 총판을 거쳐 Sangfor로"
          >
            <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-primary">
              나
            </span>
            <span className="text-muted-foreground" aria-hidden="true">
              ▸
            </span>
            <span className="rounded-full border px-3 py-1">
              {distributorLabel}
            </span>
            <span className="text-muted-foreground" aria-hidden="true">
              ▸
            </span>
            <span className="rounded-full border px-3 py-1">Sangfor</span>
          </div>

          {/* SPR status badge */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">SPR 상태</span>
            {sprStatus ? (
              <Badge variant={variant} className="text-xs">
                {meta.label}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">
                — (미등록 / 요청 전)
              </span>
            )}
          </div>

          {/* Raw value note when the status is a freeform string */}
          {sprStatus && normalised !== sprStatus && (
            <p className="text-xs text-muted-foreground">
              원본: {sprStatus}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/** ③ 경쟁 포지셔닝 — placeholder list. */
function CompetitorSection({ competitors }: { competitors: string[] }) {
  return (
    <section aria-labelledby="competitor-heading">
      <div className="flex items-center gap-2 pb-3">
        <Swords className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id="competitor-heading" className="text-sm font-bold">
          경쟁 포지셔닝
        </h3>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs text-muted-foreground font-normal">
            딜에 등록된 경쟁사 정보
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {competitors.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              — 경쟁사 정보 없음
            </p>
          ) : (
            <ul className="space-y-1">
              {competitors.map((name) => (
                <li
                  key={name}
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium"
                >
                  <span
                    className="size-2 rounded-full bg-destructive"
                    aria-hidden="true"
                  />
                  {name}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            채널·등록 탭에서 경쟁사를 추가할 수 있습니다.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// BidWorkPanel — stage ④ 선정·입찰 work surface
// ---------------------------------------------------------------------------

/**
 * Stage ④ (선정·입찰) work surface.
 *
 * Sections:
 *  1. 입찰 — quote list (reuses existing Quote DB data, no new creation UI)
 *  2. 특별가(SPR) 요청 — channel chain + sprStatus badge (regStatusMeta)
 *  3. 경쟁 포지셔닝 — static placeholder (no competitor table in DB yet)
 */
export function BidWorkPanel({
  opportunityId,
  quotes,
  sprStatus,
  distributorName,
  competitors,
}: BidWorkPanelProps) {
  return (
    <div className="space-y-6" role="region" aria-label="④ 선정·입찰 작업 패널">
      <BidQuotesSection opportunityId={opportunityId} quotes={quotes} />
      <SprSection sprStatus={sprStatus} distributorName={distributorName} />
      <CompetitorSection competitors={competitors} />
    </div>
  );
}
