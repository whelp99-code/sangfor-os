export const dynamic = "force-dynamic";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { listOpportunities, resolveOpportunityAuthContext } from "@sangfor/business";
import {
  isActiveOpportunity,
  isRecognizedStage,
  normalizeOpportunityStage,
} from "@sangfor/business/opportunity-stage";

import { MetricCard, MetricGrid } from "@/components/ui/metric-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatKRWCompact, stageDisplay } from "@/components/deals/stage-meta";
import { regStatusMeta } from "@/components/deals/reg-status";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";
import { cn } from "@/lib/utils";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

// ---------------------------------------------------------------------------
// Stage funnel buckets — ③결과 / ⑤수주 / ⑥딜리버리 had no enum mapping and
// were always 0; superseded by the 기타 catch-all.
// ---------------------------------------------------------------------------
const FUNNEL_BUCKETS: { idx: number; label: string }[] = [
  { idx: 1, label: "① 제안" },
  { idx: 2, label: "② PoC" },
  { idx: 4, label: "④ 선정·입찰" },
  { idx: 0, label: "기타" },
];

const TOTAL_PIPS = 6;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (v == null) return 0;
  const n = Number(String(v));
  return Number.isFinite(n) ? n : 0;
}

// ---------------------------------------------------------------------------
// Sub-components (server-only, no "use client")
// ---------------------------------------------------------------------------

type StagePipsProps = { idx: number; isLost?: boolean };
function StagePips({ idx, isLost }: StagePipsProps) {
  return (
    <div
      className={cn("flex items-center gap-2", isLost && "opacity-60")}
      aria-label={`단계 ${idx} / ${TOTAL_PIPS}`}
    >
      <div className="flex items-center gap-0.5" aria-hidden>
        {Array.from({ length: TOTAL_PIPS }, (_, i) => {
          const pipNum = i + 1;
          const isCurrent = pipNum === idx;
          const isFilled = pipNum < idx;
          return (
            <span
              key={i}
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isFilled && "bg-primary/40",
                isCurrent && "bg-primary ring-2 ring-primary/30",
                !isFilled && !isCurrent && "bg-muted"
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default async function HomePage() {
  const token = (await cookies()).get("session")?.value;
  if (!token) redirect("/login");
  const session = await evaluatePersistedSessionFromRequest(new Request(
    "http://sangfor.local/home",
    { headers: { cookie: `session=${encodeURIComponent(token)}` } },
  ));
  if (!session.ok) redirect("/login");
  const ctx = await resolveOpportunityAuthContext({
    userId: session.userId,
    sessionId: null,
    tenantId: session.tenantId,
    companyId: session.companyId,
    projectId: session.projectId,
    product: "portal",
  });
  const opportunityPage = await listOpportunities(ctx, { first: 100 });
  const opportunities = serializeDecimalAtBoundary(opportunityPage.items);

  // -- KPI derivations -------------------------------------------------------
  const openDeals = opportunities.filter((opp) => isActiveOpportunity(opp.stage));

  const weightedPipeline = openDeals.reduce((sum, opp) => {
    const amount = toNum(opp.amount);
    const prob = typeof opp.probability === "number" ? opp.probability : 20;
    return sum + amount * (prob / 100);
  }, 0);

  const wonThisMonth = opportunities.filter((opp) => {
    const stage = normalizeOpportunityStage(opp.stage);
    if (stage !== "WON") return false;
    const updated = opp.updatedAt ? new Date(opp.updatedAt) : null;
    if (!updated) return false;
    const now = new Date();
    return (
      updated.getFullYear() === now.getFullYear() &&
      updated.getMonth() === now.getMonth()
    );
  });

  const wonThisMonthAmount = wonThisMonth.reduce(
    (sum, opp) => sum + toNum(opp.amount),
    0
  );

  // Protection expiring within 7 days
  // eslint-disable-next-line react-hooks/purity -- server component renders once per request; request-time read is intentional
  const now = Date.now();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  const expiringProtection = opportunities.filter((opp) => {
    const expires = opp.dealRegistration?.protectionExpiresAt;
    if (!expires) return false;
    const t = new Date(expires).getTime();
    return t > now && t - now <= sevenDays;
  });

  // -- Stage funnel ----------------------------------------------------------
  // Count by display group; unmapped / unrecognised stages land in 기타.
  const stageCounts: Record<number, number> = { 0: 0, 1: 0, 2: 0, 4: 0 };
  for (const opp of openDeals) {
    if (!isRecognizedStage(opp.stage)) {
      stageCounts[0]++;
    } else {
      const { idx } = stageDisplay(opp.stage);
      if (idx in stageCounts) stageCounts[idx]++;
      else stageCounts[0]++;
    }
  }
  const maxCount = Math.max(1, ...Object.values(stageCounts));

  // -- Recent deals (last 5 open, newest first) ------------------------------
  const recentDeals = [...openDeals].slice(0, 5);

  // -- Risk list -------------------------------------------------------------
  // Risk = REJECTED / EXPIRED / CONTESTED reg, or protection expiring soon
  const RISK_STATUSES = new Set(["REJECTED", "EXPIRED", "CONTESTED"]);

  const riskItems = opportunities
    .filter((opp) => {
      const rs = opp.dealRegistration?.regStatus;
      if (rs && RISK_STATUSES.has(rs)) return true;
      const expires = opp.dealRegistration?.protectionExpiresAt;
      if (expires) {
        const t = new Date(expires).getTime();
        if (t > now && t - now <= sevenDays) return true;
      }
      return false;
    })
    .slice(0, 8);

  return (
    <div className="space-y-4">
      {/* Page title — primary landmark heading for screen readers */}
      <h1 className="text-xl font-bold tracking-tight">홈 — 영업 대시보드</h1>

      {/* KPI row */}
      <MetricGrid>
        <MetricCard
          label="진행중 딜"
          value={openDeals.length}
           href="/deals"
        />
        <MetricCard
          label="가중 예상매출"
          value={formatKRWCompact(weightedPipeline)}
          href="/deals"
        />
        <MetricCard
          label="이번달 수주"
          value={formatKRWCompact(wonThisMonthAmount)}
          href="/deals"
        />
        <MetricCard
          label="보호 만료 임박"
          value={expiringProtection.length}
          href="/deals"
          delta={
            expiringProtection.length > 0
              ? { label: "7일 이내 만료", tone: "bad" }
              : undefined
          }
        />
      </MetricGrid>

      {/* Stage funnel panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">단계별 파이프라인</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-2">
            {/* Labels */}
            <div className="flex gap-1.5">
              {FUNNEL_BUCKETS.map((s) => (
                <div
                  key={s.idx}
                  className="flex-1 text-center text-xs font-semibold text-muted-foreground"
                >
                  {s.label}
                </div>
              ))}
            </div>
            {/* Bars — sr-only text alternative summarizes every stage count */}
            <div
              className="flex items-end gap-1.5"
              style={{ height: "96px" }}
              role="img"
              aria-label={`단계별 파이프라인: ${FUNNEL_BUCKETS.map(
                (s) => `${s.label} ${stageCounts[s.idx] ?? 0}건`
              ).join(", ")}`}
            >
              {FUNNEL_BUCKETS.map((s) => {
                const count = stageCounts[s.idx] ?? 0;
                const heightPct = Math.round((count / maxCount) * 100);
                return (
                  <div
                    key={s.idx}
                    className="flex flex-1 flex-col items-center justify-end"
                    style={{ height: "100%" }}
                  >
                    <span className="mb-1 text-[11px] font-bold text-primary">
                      {count}
                    </span>
                    <div
                      className="w-full rounded-t-md bg-primary/15 ring-1 ring-primary/20"
                      style={{ height: `${heightPct}%`, minHeight: count > 0 ? "8px" : "2px" }}
                      aria-label={`${s.label}: ${count}건`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid: recent deals + risk rail */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">

        {/* LEFT: 최근 딜 table */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-sm font-semibold">최근 딜</CardTitle>
            <Link href="/deals" className="text-xs text-primary hover:underline">
              파이프라인 보기
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {recentDeals.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">진행 중인 딜이 없습니다.</p>
                <Link
                  href="/deals/registrations"
                  className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
                >
                  딜 등록하기
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground whitespace-nowrap">
                        프로젝트 ID
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                        딜 / 고객사
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground">
                        단계
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-muted-foreground">
                        금액
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentDeals.map((deal) => {
                      const { idx, label } = stageDisplay(deal.stage);
                      const isLost = deal.dealStatus === "LOST";
                      return (
                        <tr
                          key={deal.id}
                          className="border-b last:border-0 hover:bg-muted/30"
                        >
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            {deal.code ? (
                              <Link
                                href={`/deals/${deal.id}`}
                                className="font-mono text-xs font-bold text-primary hover:underline"
                              >
                                {deal.code}
                              </Link>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="font-medium text-foreground truncate max-w-[200px]">
                              {deal.title}
                            </div>
                            {deal.customer?.name && (
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {deal.customer.name}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <StagePips idx={idx} isLost={isLost} />
                              <span className="text-xs font-semibold text-primary">
                                {label}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums text-xs font-medium whitespace-nowrap">
                            {toNum(deal.amount) > 0
                              ? formatKRWCompact(toNum(deal.amount))
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* RIGHT: risk list */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm font-semibold">
              <AlertTriangle className="size-4 text-destructive" aria-hidden />
              위험 — 즉시 대응
            </CardTitle>
          </CardHeader>
          <CardContent
            className="space-y-3"
            role="list"
            aria-label="즉시 대응이 필요한 위험 목록"
          >
            {riskItems.length === 0 ? (
              <p className="text-sm text-muted-foreground" role="none">
                현재 즉시 대응이 필요한 위험이 없습니다.
              </p>
            ) : (
              riskItems.map((opp) => {
                const rs = opp.dealRegistration?.regStatus ?? null;
                const expires = opp.dealRegistration?.protectionExpiresAt ?? null;
                const meta = regStatusMeta(rs, expires ?? undefined);
                const isExpiringSoon =
                  rs === "APPROVED" && expires
                    ? new Date(expires).getTime() - now <= sevenDays
                    : false;
                const badgeTone =
                  RISK_STATUSES.has(rs ?? "") || isExpiringSoon ? "destructive" : "outline";
                return (
                  <div
                    key={opp.id}
                    className="flex items-start gap-2.5"
                    role="listitem"
                  >
                    <span
                      className="mt-1.5 size-2 shrink-0 rounded-full bg-destructive"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground truncate">
                          {opp.title}
                        </span>
                        <Badge variant={badgeTone} className="shrink-0">
                          {meta.label}
                          {meta.dday ? ` ${meta.dday}` : ""}
                        </Badge>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {opp.code && (
                          <Link
                            href={`/deals/${opp.id}`}
                            className="font-mono text-xs text-primary hover:underline"
                          >
                            {opp.code}
                          </Link>
                        )}
                        {opp.customer?.name && (
                          <span className="text-xs text-muted-foreground">
                            {opp.customer.name}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
