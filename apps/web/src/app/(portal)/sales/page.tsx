"use client";

import { useEffect, useMemo, useState } from "react";
import { DollarSign, Phone, Clock, FileText, RefreshCw, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { STATUS_LABELS } from "@sangfor/shared";
import { AIWorkspaceLayout } from "@/components/ai-workspace";

type SalesData = {
  pipeline: { id: string; customer: string | null; stage: string; value: number }[];
  followUp: number;
  pendingApprovals: number;
  proposalsInProgress: number;
  renewalsDue: number;
  riskDeals: number;
};

const SALES_ACTIVITIES: { id: string; time: string; icon?: React.ReactNode; text: string; type: 'success' | 'info' | 'warning' | 'error' }[] = []

const SALES_STATS: { label: string; value: string; type: 'success' | 'warning' | 'error' | 'default' }[] = []

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-32 animate-pulse rounded-2xl bg-muted" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-12 text-center dark:border-red-900/50 dark:bg-red-950/20">
      <AlertTriangle className="h-10 w-10 text-red-500" />
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">대시보드를 불러오지 못했습니다</h2>
      <p className="text-sm text-red-600 dark:text-red-300">{message}</p>
    </div>
  );
}

const handleCommand = async (_command: string) => {
  // TODO(oma-deferred): wire the sales AI assistant when the endpoint is provisioned.
  return "AI 어시스턴트는 준비 중입니다"
}

export default function SalesDashboardPage() {
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/dashboard/sales");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : "알 수 없는 오류");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Derive pipeline aggregates once per data change (single pass over pipeline)
  // rather than re-running reduce + filter().length on every render.
  const { totalPipeline, quoteStageCount } = useMemo(() => {
    const rows = data?.pipeline ?? [];
    let total = 0;
    let quoteCount = 0;
    for (const o of rows) {
      total += o.value;
      if (o.stage === "quote") quoteCount += 1;
    }
    return { totalPipeline: total, quoteStageCount: quoteCount };
  }, [data]);

  return (
    <AIWorkspaceLayout
      title="영업"
      subtitle="AI가 파이프라인을 자동 관리합니다"
      activities={SALES_ACTIVITIES}
      stats={SALES_STATS}
      onCommand={handleCommand}
    >
      {loading ? (
        <LoadingSkeleton />
      ) : error ? (
        <ErrorState message={error} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-blue-600" />
                  <CardTitle className="text-base">내 Pipeline</CardTitle>
                </div>
                <CardDescription>단계별 영업 파이프라인 및 가중 예측</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data?.pipeline.length ? (
                  <>
                    <MetricRow label="열린 기회" value={String(data.pipeline.length)} />
                    <MetricRow label="가중 예상 매출" value={`₩${Math.round(totalPipeline * 0.4).toLocaleString("ko-KR")}`} />
                    <MetricRow label="파이프라인 합계" value={`₩${totalPipeline.toLocaleString("ko-KR")}`} />
                  </>
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">파이프라인 데이터 없음</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Phone className="h-5 w-5 text-emerald-600" />
                  <CardTitle className="text-base">오늘 Follow-up</CardTitle>
                </div>
                <CardDescription>Tasks and calls scheduled for today</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? (
                  data.followUp > 0 ? (
                    <MetricRow label="Discovery follow-up" value={String(data.followUp)} />
                  ) : (
                    <p className="py-4 text-center text-sm text-muted-foreground">오늘 예정된 follow-up 없음</p>
                  )
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Clock className="h-5 w-5 text-amber-600" />
                  <CardTitle className="text-base">승인 대기</CardTitle>
                </div>
                <CardDescription>Pending Opportunity approvals</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? (
                  <>
                    <MetricRow label="대기 건수" value={String(data.pendingApprovals)} />
                    <MetricRow label="상태" value={STATUS_LABELS.ready_for_human_approval} />
                  </>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-purple-600" />
                  <CardTitle className="text-base">제안서 작성 중</CardTitle>
                </div>
                <CardDescription>Proposals in progress</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? (
                  <MetricRow label="진행 중" value={String(data.proposalsInProgress)} />
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5 text-indigo-600" />
                  <CardTitle className="text-base">갱신 예정 고객</CardTitle>
                </div>
                <CardDescription>Renewal alerts — 90-day window</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <MetricRow label="갱신 예정" value={String(data?.renewalsDue ?? 0)} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-600" />
                  <CardTitle className="text-base">위험 딜</CardTitle>
                </div>
                <CardDescription>Deals at risk of slipping or losing</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? (
                  <>
                    <MetricRow label="$50K+ 견적 딜" value={String(data.riskDeals)} />
                    <MetricRow label="단계 변경" value={String(quoteStageCount)} />
                  </>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </AIWorkspaceLayout>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold">{value}</span>
    </div>
  );
}
