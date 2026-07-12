export const dynamic = "force-dynamic"

import { Gauge } from "lucide-react"
import { prisma } from "@sangfor/db"
import { computeDealRisk, resolveDefaultProjectId, type DealRiskFactor } from "@sangfor/business"
import { formatKRWCompact } from "@sangfor/shared"

import { DashboardAiShell } from "@/components/dashboard/dashboard-ai-shell"
import { ExecutiveDashboard } from "@/components/dashboard/executive-dashboard"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const ACTIVITIES: { id: string; time: string; icon?: React.ReactNode; text: string; type: 'success' | 'info' | 'warning' | 'error' }[] = []

const STATS: { label: string; value: string; type: 'success' | 'warning' | 'error' | 'default' }[] = []

const MS_PER_DAY = 1000 * 60 * 60 * 24
const MAX_AT_RISK_DEALS = 8

type AtRiskDeal = {
  id: string
  title: string
  customerName: string | null
  amount: number | null
  score: number
  level: "low" | "medium" | "high"
  topFactors: DealRiskFactor[]
}

async function loadAtRiskDeals(): Promise<AtRiskDeal[]> {
  const projectId = await resolveDefaultProjectId()
  const deals = await prisma.opportunity.findMany({
    where: { projectId, archivedAt: null, dealStatus: "OPEN", stage: { notIn: ["WON", "LOST"] } },
    include: { customer: true },
  })

  const now = Date.now()
  const scored: AtRiskDeal[] = deals.map((deal) => {
    const dwellFrom = deal.stageEnteredAt ?? deal.createdAt
    const stageDwellDays = Math.max(0, Math.floor((now - dwellFrom.getTime()) / MS_PER_DAY))
    const overdueDays = deal.closeDate ? Math.floor((now - deal.closeDate.getTime()) / MS_PER_DAY) : null
    const risk = computeDealRisk({
      stageDwellDays,
      amount: deal.amount != null ? Number(deal.amount) : null,
      probability: deal.probability,
      mailSilenceDays: null,
      lensFailCount: 0,
      stage: deal.stage,
      overdueDays,
      hasNextAction: Boolean(deal.nextAction && deal.nextAction.trim()),
    })
    const topFactors = [...risk.factors].sort((a, b) => b.contribution - a.contribution).slice(0, 2)
    return {
      id: deal.id,
      title: deal.title,
      customerName: deal.customer?.name ?? null,
      amount: deal.amount != null ? Number(deal.amount) : null,
      score: risk.score,
      level: risk.level,
      topFactors,
    }
  })

  return scored
    .filter((deal) => deal.level === "high" || deal.level === "medium")
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_AT_RISK_DEALS)
}

function AtRiskDealsCard({ deals }: { deals: AtRiskDeal[] }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
          <Gauge className="h-4 w-4 text-muted-foreground" />
        </div>
        <CardTitle className="text-base">주의 딜 — 리스크 스코어</CardTitle>
        <span className="ml-auto text-xs text-muted-foreground">규칙 기반 예측 · 5색 게이트 아님</span>
      </CardHeader>
      <CardContent>
        {deals.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">주의 딜 없음</p>
        ) : (
          <div className="space-y-2">
            {deals.map((deal) => (
              <div key={deal.id} className="rounded-lg border bg-background/80 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{deal.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {deal.customerName ?? "고객 미지정"}
                      {deal.amount != null ? ` · ${formatKRWCompact(deal.amount)}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-foreground/60"
                        style={{ width: `${deal.score}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-sm font-semibold tabular-nums">
                      {deal.score}점 · {deal.level === "high" ? "높음" : "중간"}
                    </span>
                  </div>
                </div>
                <ul className="mt-1.5 space-y-0.5">
                  {deal.topFactors.map((factor) => (
                    <li key={factor.key} className="text-xs text-muted-foreground">
                      {factor.label}: {factor.note}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default async function DashboardPage() {
  const atRiskDeals = await loadAtRiskDeals()

  return (
    <DashboardAiShell
      title="경영 대시보드"
      subtitle="매출·딜리버리·지원·거버넌스를 한눈에 통합 조망합니다"
      activities={ACTIVITIES}
      stats={STATS}
    >
      <div className="space-y-6">
        <AtRiskDealsCard deals={atRiskDeals} />
        <ExecutiveDashboard />
      </div>
    </DashboardAiShell>
  )
}
