import { CheckSquare, Package } from "lucide-react";
import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format-date";

// ---------------------------------------------------------------------------
// Types — all Date fields serialised to string at the page boundary.
// ---------------------------------------------------------------------------

/** Minimal DeliveryChecklistItem shape (Prisma fields minus relations). */
export type DeliveryChecklistItemSummary = {
  id: string;
  itemKey: string;
  status: string;
  completedAt: Date | string | null;
};

/** Delivery data shape passed from the page to DealWorkTab -> DeliveryWorkPanel. */
export type DeliveryData = {
  /** Engagement ID — null if no engagement exists yet. */
  engagementId: string | null;
  /** Opportunity ID for the empty-state "convert" link. */
  opportunityId: string;
  /** Checklist items persisted on the engagement, or empty when none stored. */
  checklistItems: DeliveryChecklistItemSummary[];
};

// ---------------------------------------------------------------------------
// Standard delivery gates (presentational fallback)
// ---------------------------------------------------------------------------

type GateDef = {
  key: string;
  label: string;
};

const DELIVERY_GATES: GateDef[] = [
  { key: "kickoff", label: "킥오프(Kick-off)" },
  { key: "frd", label: "설계 — FRD(기능요구사항) 확정" },
  { key: "build", label: "구축 · 통합" },
  { key: "purchase", label: "제품 구매 (총판)" },
  { key: "uat", label: "UAT — 고객 주도 · 사인오프 인증서" },
  { key: "golive", label: "Go-Live — Go/No-Go 판정" },
  { key: "handover", label: "핸드오버 · 하이퍼케어" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


function isDone(status: string): boolean {
  return status === "done" || status === "completed";
}

// ---------------------------------------------------------------------------
// Section: 딜리버리 단계 게이트
// ---------------------------------------------------------------------------

type GateSectionProps = {
  checklistItems: DeliveryChecklistItemSummary[];
  hasEngagement: boolean;
};

function GateSection({ checklistItems, hasEngagement }: GateSectionProps) {
  const hasItems = checklistItems.length > 0;

  return (
    <section aria-labelledby="delivery-gate-heading">
      <div className="flex items-center gap-2 pb-3">
        <CheckSquare className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id="delivery-gate-heading" className="text-sm font-bold">
          딜리버리 단계 게이트
        </h3>
      </div>

      <Card>
        <CardContent className="pt-4 pb-2">
          <ul className="flex flex-col divide-y" role="list">
            {hasItems
              ? checklistItems.map((item) => {
                  const done = isDone(item.status);
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-3 py-2.5"
                    >
                      {/* Checkbox indicator */}
                      <span
                        aria-hidden="true"
                        className={cn(
                          "inline-flex size-4 shrink-0 items-center justify-center rounded border",
                          done
                            ? "border-success bg-success text-success-foreground text-[10px]"
                            : "border-muted-foreground/40"
                        )}
                      >
                        {done ? "✓" : ""}
                      </span>

                      {/* Label */}
                      <span
                        className={cn(
                          "flex-1 text-sm font-semibold",
                          done && "text-muted-foreground line-through decoration-muted-foreground/40"
                        )}
                      >
                        {item.itemKey}
                      </span>

                      {/* Meta */}
                      {done && item.completedAt && (
                        <span className="text-xs text-muted-foreground">
                          완료 · {formatDate(item.completedAt)}
                        </span>
                      )}

                      {/* Status badge */}
                      <Badge
                        variant={done ? "default" : "outline"}
                        className={cn(
                          "text-[11px]",
                          done && "bg-success hover:bg-success text-success-foreground"
                        )}
                      >
                        {done ? "완료" : "대기"}
                      </Badge>
                    </li>
                  );
                })
              : DELIVERY_GATES.map((gate) => (
                  <li
                    key={gate.key}
                    className="flex items-center gap-3 py-2.5"
                  >
                    <span
                      aria-hidden="true"
                      className="inline-flex size-4 shrink-0 items-center justify-center rounded border border-muted-foreground/40"
                    />
                    <span className="flex-1 text-sm font-semibold text-muted-foreground">
                      {gate.label}
                    </span>
                    <Badge variant="outline" className="text-[11px]">
                      예정
                    </Badge>
                  </li>
                ))}
          </ul>

          {/* Note when showing template only */}
          {!hasItems && hasEngagement && (
            <p className="mt-3 mb-1 text-xs text-muted-foreground">
              엔게이지먼트 생성 후 추적
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Section: 제품·라이선스 (presentational)
// ---------------------------------------------------------------------------

type LicenseRowDef = {
  key: string;
  label: string;
  meta: string;
  variant: "ok" | "info" | "todo";
  badgeLabel: string;
};

const LICENSE_ROWS: LicenseRowDef[] = [
  {
    key: "purchase",
    label: "제품 구매 (총판)",
    meta: "총판 발주 및 입고",
    variant: "ok",
    badgeLabel: "완료",
  },
  {
    key: "license",
    label: "라이선스 프로비저닝 (Sangfor)",
    meta: "SN 발급 대기",
    variant: "info",
    badgeLabel: "진행",
  },
  {
    key: "tac",
    label: "TAC 등록",
    meta: "라이선스 확정 후 진행",
    variant: "todo",
    badgeLabel: "대기",
  },
];

function LicenseSection() {
  return (
    <section aria-labelledby="delivery-license-heading">
      <div className="flex items-center gap-2 pb-3">
        <Package className="size-4 text-muted-foreground" aria-hidden="true" />
        <h3 id="delivery-license-heading" className="text-sm font-bold">
          제품·라이선스
        </h3>
      </div>

      <Card>
        <CardContent className="pt-4 pb-2">
          <ul className="flex flex-col divide-y" role="list">
            {LICENSE_ROWS.map((row) => (
              <li key={row.key} className="flex items-center gap-3 py-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "inline-flex size-4 shrink-0 items-center justify-center rounded border text-[10px]",
                    row.variant === "ok"
                      ? "border-success bg-success text-success-foreground"
                      : "border-muted-foreground/40"
                  )}
                >
                  {row.variant === "ok" ? "✓" : ""}
                </span>

                <span className="flex-1">
                  <span
                    className={cn(
                      "text-sm font-semibold",
                      row.variant === "ok" &&
                        "text-muted-foreground line-through decoration-muted-foreground/40"
                    )}
                  >
                    {row.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {row.meta}
                  </span>
                </span>

                <Badge
                  variant={row.variant === "todo" ? "outline" : "default"}
                  className={cn(
                    "text-[11px]",
                    row.variant === "ok" && "bg-success hover:bg-success text-success-foreground",
                    row.variant === "info" && "bg-primary hover:bg-primary"
                  )}
                >
                  {row.badgeLabel}
                </Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

// ---------------------------------------------------------------------------
// DeliveryWorkPanel — stage ⑥ 딜리버리 work surface
// ---------------------------------------------------------------------------

/**
 * Stage ⑥ (딜리버리) work surface.
 *
 * Sections:
 *  1. 딜리버리 단계 게이트 — DeliveryChecklistItem rows (or 7 template gates)
 *  2. 제품·라이선스 — presentational status rows
 *
 * Empty state when no engagement: prompts user to convert via the header button.
 */
export function DeliveryWorkPanel({
  engagementId,
  opportunityId,
  checklistItems,
}: DeliveryData) {
  if (!engagementId) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Package className="size-10 text-muted-foreground/40" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold">딜리버리는 수주(⑤) 후 시작됩니다</p>
            <p className="mt-1 text-xs text-muted-foreground">
              상단 헤더의{" "}
              <Link
                href={`/deals/${opportunityId}`}
                className={cn(
                  buttonVariants({ variant: "link", size: "sm" }),
                  "h-auto p-0 text-xs"
                )}
              >
                &ldquo;프로젝트로 전환&rdquo;
              </Link>{" "}
              버튼으로 프로젝트를 생성하면 딜리버리를 추적할 수 있습니다.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6" role="region" aria-label="⑥ 딜리버리 작업 패널">
      <GateSection
        checklistItems={checklistItems}
        hasEngagement={true}
      />
      <LicenseSection />
    </div>
  );
}
