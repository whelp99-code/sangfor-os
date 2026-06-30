import Link from "next/link";
import { FlaskConical, PlusCircle, ExternalLink, CheckSquare, AlertTriangle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Lean data types — no Prisma imports; server-safe.
// ---------------------------------------------------------------------------
export type PocChecklistItemSummary = {
  id: string;
  label: string;
  done: boolean;
};

export type PocIssueSummary = {
  id: string;
  title: string;
  severity: string;
  status: string;
};

export type PocProjectSummary = {
  id: string;
  title: string;
  status: string;
  productName: string | null;
  customer: { name: string } | null;
  checklistItems: PocChecklistItemSummary[];
  issues: PocIssueSummary[];
};

type PocWorkPanelProps = {
  pocProjects: PocProjectSummary[];
};

// ---------------------------------------------------------------------------
// Status badge helpers
// ---------------------------------------------------------------------------
const STATUS_LABEL: Record<string, string> = {
  planning: "계획중",
  in_progress: "진행중",
  completed: "완료",
  archived: "보관",
};

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  planning: "outline",
  in_progress: "default",
  completed: "secondary",
  archived: "secondary",
};

const ISSUE_SEVERITY_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  high: "destructive",
  medium: "default",
  low: "secondary",
};

const ISSUE_SEVERITY_LABEL: Record<string, string> = {
  high: "리스크",
  medium: "진행중",
  low: "참고",
};

// ---------------------------------------------------------------------------
// PocWorkPanel — stage ② (PoC)
// Reuses PocProject data; links to existing /poc/[id] for editing.
// Empty state links to /poc (existing PoC create flow).
// ---------------------------------------------------------------------------
export function PocWorkPanel({ pocProjects }: PocWorkPanelProps) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FlaskConical className="size-4 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-base font-bold">② PoC — 평가계획 · 체크리스트 · 이슈</h2>
          {pocProjects.length > 0 && (
            <Badge variant="outline" className="text-xs">
              {pocProjects.length}건
            </Badge>
          )}
        </div>
        <Link
          href="/poc"
          className={cn(buttonVariants({ size: "sm", variant: "outline" }), "gap-1.5")}
        >
          <PlusCircle className="size-3.5" aria-hidden="true" />
          PoC 등록
        </Link>
      </div>

      {/* Empty state */}
      {pocProjects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <FlaskConical className="mx-auto mb-3 size-8 opacity-40" aria-hidden="true" />
            <p className="font-medium">이 딜에 연결된 PoC가 없습니다</p>
            <p className="mt-1">
              <Link
                href="/poc"
                className="text-primary underline-offset-4 hover:underline"
              >
                PoC 등록 페이지에서 새 PoC를 만드세요
              </Link>
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pocProjects.map((poc) => (
            <PocProjectCard key={poc.id} poc={poc} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PocProjectCard — individual PoC project summary card
// ---------------------------------------------------------------------------
function PocProjectCard({ poc }: { poc: PocProjectSummary }) {
  const statusLabel = STATUS_LABEL[poc.status] ?? poc.status;
  const statusVariant = STATUS_VARIANT[poc.status] ?? "outline";

  const doneCount = poc.checklistItems.filter((item) => item.done).length;
  const totalCount = poc.checklistItems.length;
  const openIssues = poc.issues.filter((issue) => issue.status !== "resolved");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate font-bold">{poc.title}</span>
            <Badge variant={statusVariant} className="shrink-0 text-xs">
              {statusLabel}
            </Badge>
          </div>
          <Link
            href={`/poc/${poc.id}`}
            className={cn(
              buttonVariants({ size: "icon", variant: "ghost" }),
              "size-7 shrink-0"
            )}
            aria-label="PoC 상세 열기"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </Link>
        </CardTitle>
        {poc.customer ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {poc.customer.name}
            {poc.productName ? ` · ${poc.productName}` : ""}
          </p>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* Checklist summary */}
        <section aria-label="성공기준 체크리스트">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <CheckSquare className="size-3.5" aria-hidden="true" />
            성공기준 체크리스트
            <span
              className={cn(
                "ml-auto font-bold tabular-nums",
                doneCount === totalCount && totalCount > 0
                  ? "text-green-700"
                  : "text-foreground"
              )}
            >
              {doneCount} / {totalCount}
            </span>
          </div>
          {poc.checklistItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">체크리스트 항목 없음</p>
          ) : (
            <ul className="space-y-1.5" role="list">
              {poc.checklistItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded border",
                      item.done
                        ? "border-green-600 bg-green-600 text-white"
                        : "border-border"
                    )}
                    aria-label={item.done ? "완료" : "미완료"}
                    role="img"
                  >
                    {item.done ? (
                      <svg
                        width="10"
                        height="8"
                        viewBox="0 0 10 8"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M1 4l3 3 5-6"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : null}
                  </span>
                  <span
                    className={cn(
                      "flex-1",
                      item.done && "text-muted-foreground line-through decoration-muted-foreground/40"
                    )}
                  >
                    {item.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Issues summary */}
        {poc.issues.length > 0 && (
          <section aria-label="이슈">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              <AlertTriangle className="size-3.5" aria-hidden="true" />
              이슈
              <span className="ml-auto font-bold tabular-nums text-foreground">
                {openIssues.length}건 미해결
              </span>
            </div>
            <ul className="space-y-1.5" role="list">
              {poc.issues.map((issue) => {
                const sevLabel = ISSUE_SEVERITY_LABEL[issue.severity] ?? issue.severity;
                const sevVariant = ISSUE_SEVERITY_VARIANT[issue.severity] ?? "outline";
                return (
                  <li key={issue.id} className="flex items-center gap-2 text-sm">
                    <Badge variant={sevVariant} className="shrink-0 text-xs">
                      {sevLabel}
                    </Badge>
                    <span
                      className={cn(
                        "flex-1",
                        issue.status === "resolved" && "text-muted-foreground line-through decoration-muted-foreground/40"
                      )}
                    >
                      {issue.title}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Link to full PoC workspace */}
        <Link
          href={`/poc/${poc.id}`}
          className={cn(
            buttonVariants({ size: "sm", variant: "outline" }),
            "w-full"
          )}
        >
          PoC 상세 · 체크리스트 관리
        </Link>
      </CardContent>
    </Card>
  );
}
