import { FileText, Link2, Coins } from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-date";
import { formatKRWShort } from "@/lib/format-krw";

// ---------------------------------------------------------------------------
// Types — all Decimal fields serialised to string at the page boundary.
// ---------------------------------------------------------------------------

/** Minimal engagement shape for the win panel. */
export type EngagementSummary = {
  id: string;
  name: string;
  status: string;
  summaryMarkdown: string | null;
  sowApprovedAt: Date | string | null;
};

export type WinWorkPanelProps = {
  opportunityId: string;
  /** Serialised Decimal: "420000000" or null if no amount set. */
  amount: string | null;
  /** Existing engagement (null if not yet converted). */
  engagement: EngagementSummary | null;
  /** Distributor in the PO chain, e.g. "XX총판". */
  distributorName: string | null;
};

// ---------------------------------------------------------------------------
// Milestone definitions (presentational — no backend model yet)
// ---------------------------------------------------------------------------

type MilestoneDef = {
  label: string;
  ratio: number; // 0-1
  status: "info" | "todo";
};

const MILESTONES: MilestoneDef[] = [
  { label: "설계 완료", ratio: 0.3, status: "info" },
  { label: "통합 완료", ratio: 0.3, status: "todo" },
  { label: "UAT 통과", ratio: 0.2, status: "todo" },
  { label: "Go-Live", ratio: 0.2, status: "todo" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAmount(value: string | null, ratio: number): string {
  if (!value) return `${Math.round(ratio * 100)}%`;
  const total = Number(value);
  if (!Number.isFinite(total) || total <= 0) return `${Math.round(ratio * 100)}%`;
  return formatKRWShort(total * ratio, 2);
}

// ---------------------------------------------------------------------------
// Section: SOW / 계약
// ---------------------------------------------------------------------------

function SowSection({
  opportunityId,
  engagement,
}: {
  opportunityId: string;
  engagement: EngagementSummary | null;
}) {
  const signed = !!engagement?.sowApprovedAt;

  return (
    <section aria-labelledby="win-sow-heading">
      <div className="flex items-center gap-2 pb-3">
        <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id="win-sow-heading" className="text-sm font-bold">
          SOW / 계약
        </h3>
      </div>

      {engagement ? (
        <Card>
          <CardContent className="pt-4 pb-4 space-y-3">
            {/* SOW body */}
            {engagement.summaryMarkdown ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed">
                {engagement.summaryMarkdown}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {engagement.name}
              </p>
            )}

            {/* Contract status */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">계약 상태</span>
              {signed ? (
                <>
                  <Badge variant="default" className="bg-success text-xs hover:bg-success text-success-foreground">
                    서명 완료
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(engagement.sowApprovedAt)} 고객·파트너 양측 날인
                  </span>
                </>
              ) : (
                <Badge variant="outline" className="text-xs">
                  준비중
                </Badge>
              )}
            </div>

            {/* Link to project */}
            <div>
              <Link
                href={`/projects/${engagement.id}`}
                className={cn(
                  buttonVariants({ size: "sm", variant: "outline" }),
                  "text-xs gap-1.5"
                )}
              >
                프로젝트 보기 →
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        /* Empty state — point to the existing ConvertToProjectButton in the header */
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto mb-2 size-8 opacity-40" aria-hidden="true" />
            <p className="font-medium">아직 SOW가 없습니다.</p>
            <p className="mt-1 text-xs">
              상단 헤더의{" "}
              <Link
                href={`/deals/${opportunityId}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                &ldquo;프로젝트로 전환&rdquo;
              </Link>{" "}
              버튼으로 프로젝트를 생성하면 SOW를 작성할 수 있습니다.
            </p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: PO 체인
// ---------------------------------------------------------------------------

type PoNodeProps = {
  label: string;
  sublabel: string;
  statusLabel: string;
  variant: "customer" | "me" | "default";
  statusVariant: "ok" | "info" | "warn";
};

function PoNode({ label, sublabel, statusLabel, variant, statusVariant }: PoNodeProps) {
  const nodeClass = cn(
    "rounded-2xl border px-3 py-1.5 text-xs font-bold leading-tight",
    variant === "customer" && "border-success/30 bg-success-subtle text-success",
    variant === "me" && "border-primary/20 bg-primary/10 text-primary",
    variant === "default" && "border bg-muted"
  );

  const pillClass = cn(
    "inline-block rounded-full px-1.5 py-0.5 text-[10px] font-bold",
    statusVariant === "ok" && "bg-success-subtle text-success",
    statusVariant === "info" && "bg-primary/10 text-primary",
    statusVariant === "warn" && "bg-amber-50 text-amber-700"
  );

  return (
    <span className={nodeClass}>
      {label}
      <br />
      <span className="font-normal text-muted-foreground">{sublabel}</span>{" "}
      <span className={pillClass}>{statusLabel}</span>
    </span>
  );
}

function PoChainSection({ distributorName }: { distributorName: string | null }) {
  const distLabel = distributorName ?? "총판";

  return (
    <section aria-labelledby="win-po-heading">
      <div className="flex items-center gap-2 pb-3">
        <Link2 className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id="win-po-heading" className="text-sm font-bold">
          PO 체인
        </h3>
      </div>

      <Card>
        <CardContent className="pt-4 pb-4">
          {/* Status labels below are presentational placeholders — data not yet connected */}
          <p className="mb-3 text-[11px] text-muted-foreground">
            준비중 (데이터 연결 전)
          </p>
          <div
            className="flex flex-wrap items-center gap-2"
            aria-label="PO 체인: 고객에서 나, 총판을 거쳐 Sangfor로"
          >
            <PoNode
              label="고객"
              sublabel="발주"
              statusLabel="접수"
              variant="customer"
              statusVariant="ok"
            />
            <span className="text-muted-foreground text-xs" aria-hidden="true">▸</span>
            <PoNode
              label="나 (파트너)"
              sublabel="발주"
              statusLabel="발행"
              variant="me"
              statusVariant="info"
            />
            <span className="text-muted-foreground text-xs" aria-hidden="true">▸</span>
            <PoNode
              label={distLabel}
              sublabel="발주"
              statusLabel="접수"
              variant="default"
              statusVariant="ok"
            />
            <span className="text-muted-foreground text-xs" aria-hidden="true">▸</span>
            <PoNode
              label="Sangfor"
              sublabel="발주"
              statusLabel="처리중"
              variant="default"
              statusVariant="warn"
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: 마일스톤 결제
// ---------------------------------------------------------------------------

const MILESTONE_STATUS_LABEL: Record<MilestoneDef["status"], string> = {
  info: "예정",
  todo: "미정",
};

function MilestoneSection({ amount }: { amount: string | null }) {
  return (
    <section aria-labelledby="win-milestone-heading">
      <div className="flex items-center gap-2 pb-3">
        <Coins className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id="win-milestone-heading" className="text-sm font-bold">
          마일스톤 결제
        </h3>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40">
              <TableHead className="text-xs font-semibold">마일스톤</TableHead>
              <TableHead className="text-xs font-semibold text-right">비율</TableHead>
              <TableHead className="text-xs font-semibold text-right">금액</TableHead>
              <TableHead className="text-xs font-semibold">상태</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {MILESTONES.map((m) => (
              <TableRow key={m.label} className="hover:bg-muted/20">
                <TableCell className="text-sm font-medium">{m.label}</TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {Math.round(m.ratio * 100)}%
                </TableCell>
                <TableCell className="text-right tabular-nums text-sm">
                  {formatAmount(amount, m.ratio)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={m.status === "info" ? "default" : "outline"}
                    className={cn(
                      "text-xs",
                      m.status === "info" && "bg-primary hover:bg-primary"
                    )}
                  >
                    {MILESTONE_STATUS_LABEL[m.status]}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {!amount && (
        <p className="mt-2 text-xs text-muted-foreground">
          딜 금액이 없어 비율만 표시됩니다. 상세 탭에서 금액을 입력하면 계산됩니다.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// WinWorkPanel — stage ⑤ 수주 work surface
// ---------------------------------------------------------------------------

/**
 * Stage ⑤ (수주) work surface.
 *
 * Sections:
 *  1. SOW / 계약 — Engagement summaryMarkdown + sowApprovedAt status badge
 *  2. PO 체인 — presentational chain: 고객 → 나 → 총판 → Sangfor
 *  3. 마일스톤 결제 — standard 30/30/20/20 table, amounts computed from deal amount
 */
export function WinWorkPanel({
  opportunityId,
  amount,
  engagement,
  distributorName,
}: WinWorkPanelProps) {
  return (
    <div className="space-y-6" role="region" aria-label="⑤ 수주 작업 패널">
      <SowSection opportunityId={opportunityId} engagement={engagement} />
      <PoChainSection distributorName={distributorName} />
      <MilestoneSection amount={amount} />
    </div>
  );
}
