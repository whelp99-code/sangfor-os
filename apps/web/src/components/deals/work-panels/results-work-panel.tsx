import Link from "next/link";
import { ClipboardList, PlusCircle, ExternalLink, FileText } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Lean data types — no Prisma imports; server-safe.
// ---------------------------------------------------------------------------
export type PocResultReportSummary = {
  id: string;
  title: string;
  bodyMarkdown: string;
  status: string;
  createdAt: Date | string;
};

export type PocProjectWithResults = {
  id: string;
  title: string;
  status: string;
  customer: { name: string } | null;
  resultReports: PocResultReportSummary[];
  /** Checklist done/total for metrics summary */
  checklistDone: number;
  checklistTotal: number;
};

type ResultsWorkPanelProps = {
  pocProjects: PocProjectWithResults[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const REPORT_STATUS_LABEL: Record<string, string> = {
  DRAFT: "초안",
  APPROVED: "승인",
  ARCHIVED: "보관",
};

const REPORT_STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  APPROVED: "default",
  ARCHIVED: "secondary",
};

function formatDate(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// ResultsWorkPanel — stage ③ (결과제출)
// Shows PocResultReport entries for this deal's PoC projects.
// Does NOT rebuild report generation — links to existing /poc/[id] flow.
// ---------------------------------------------------------------------------
export function ResultsWorkPanel({ pocProjects }: ResultsWorkPanelProps) {
  const allReports = pocProjects.flatMap((poc) =>
    poc.resultReports.map((r) => ({ ...r, pocId: poc.id, pocTitle: poc.title, poc }))
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ClipboardList className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-base font-bold">③ 결과제출 — PoC 결과 보고서</h2>
          {allReports.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {allReports.length}건
            </Badge>
          )}
        </div>
        {pocProjects.length > 0 ? (
          <Link
            href={`/poc/${pocProjects[0]!.id}`}
            className={cn(buttonVariants({ size: "sm", variant: "outline" }), "gap-1.5")}
          >
            <PlusCircle className="size-3.5" aria-hidden="true" />
            결과보고서 생성
          </Link>
        ) : (
          <Link
            href="/poc"
            className={cn(buttonVariants({ size: "sm", variant: "outline" }), "gap-1.5")}
          >
            <PlusCircle className="size-3.5" aria-hidden="true" />
            PoC 등록
          </Link>
        )}
      </div>

      {/* No PoC linked at all */}
      {pocProjects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <ClipboardList className="mx-auto mb-3 size-8 opacity-40" aria-hidden="true" />
            <p className="font-medium">이 딜에 연결된 PoC가 없습니다</p>
            <p className="mt-1">
              <Link
                href="/poc"
                className="text-primary underline-offset-4 hover:underline"
              >
                먼저 PoC를 등록하세요
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : allReports.length === 0 ? (
        /* PoC exists but no result reports yet */
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <FileText className="mx-auto mb-3 size-8 opacity-40" aria-hidden="true" />
            <p className="font-medium">결과 보고서가 없습니다</p>
            <p className="mt-1">
              <Link
                href={`/poc/${pocProjects[0]!.id}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                PoC 상세 페이지에서 결과 보고서를 생성하세요
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pocProjects.map((poc) => (
            <PocResultsSection key={poc.id} poc={poc} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PocResultsSection — results + metrics for one PoC project
// ---------------------------------------------------------------------------
function PocResultsSection({ poc }: { poc: PocProjectWithResults }) {
  if (poc.resultReports.length === 0) return null;

  const checklistPct =
    poc.checklistTotal > 0
      ? Math.round((poc.checklistDone / poc.checklistTotal) * 100)
      : 0;

  return (
    <div className="space-y-3">
      {/* PoC context header */}
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">{poc.title}</span>
        {poc.customer ? (
          <span className="text-xs text-muted-foreground">{poc.customer.name}</span>
        ) : null}
      </div>

      {/* Metrics summary — 성공기준 대비 결과 */}
      <div
        className="grid grid-cols-2 gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-3"
        aria-label="성공기준 대비 결과"
      >
        <MetricCell
          label="체크리스트 완료"
          value={`${poc.checklistDone} / ${poc.checklistTotal}`}
          highlight={poc.checklistDone === poc.checklistTotal && poc.checklistTotal > 0}
        />
        <MetricCell
          label="완료율"
          value={`${checklistPct}%`}
          highlight={checklistPct >= 100}
        />
        <MetricCell
          label="결과보고서"
          value={`${poc.resultReports.length}건`}
        />
      </div>

      {/* Result reports list */}
      <div className="space-y-2">
        {poc.resultReports.map((report) => (
          <ResultReportCard key={report.id} report={report} pocId={poc.id} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetricCell — inline KPI cell
// ---------------------------------------------------------------------------
function MetricCell({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-lg font-bold tabular-nums",
          highlight ? "text-green-700" : "text-foreground"
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResultReportCard — individual result report card
// ---------------------------------------------------------------------------
function ResultReportCard({
  report,
  pocId,
}: {
  report: PocResultReportSummary;
  pocId: string;
}) {
  const statusLabel = REPORT_STATUS_LABEL[report.status] ?? report.status;
  const statusVariant = REPORT_STATUS_VARIANT[report.status] ?? "outline";

  const preview = report.bodyMarkdown.slice(0, 300);
  const isTruncated = report.bodyMarkdown.length > 300;

  return (
    <Card className="transition-colors hover:bg-muted/30">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate font-bold">{report.title}</span>
            <Badge variant={statusVariant} className="shrink-0 text-xs">
              {statusLabel}
            </Badge>
          </div>
          <Link
            href={`/poc/${pocId}`}
            className={cn(
              buttonVariants({ size: "icon", variant: "ghost" }),
              "size-7 shrink-0"
            )}
            aria-label="PoC 상세에서 보고서 열기"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        </CardTitle>
        <p className="text-xs text-muted-foreground">{formatDate(report.createdAt)}</p>
      </CardHeader>
      <CardContent className="pt-0">
        <div
          className="rounded-md border bg-muted/20 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground"
          aria-label="결과 보고서 미리보기"
        >
          {preview}
          {isTruncated && (
            <span>
              {" "}...{" "}
              <Link
                href={`/poc/${pocId}`}
                className="text-primary underline-offset-4 hover:underline"
              >
                전체 보기
              </Link>
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
