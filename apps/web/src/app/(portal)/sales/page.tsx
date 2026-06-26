"use client";

import { useEffect, useState } from "react";
import { DollarSign, Phone, Clock, FileText, RefreshCw, AlertTriangle, BarChart3, CheckCircle2 } from "lucide-react";
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

// Mock AI activities for Sales
const SALES_ACTIVITIES = [
  { id: '1', time: new Date(Date.now() - 1000*30).toISOString(), icon: <BarChart3 className="h-3.5 w-3.5" />, text: '파이프라인 자동 업데이트 — 신규 Deal 2건 등록', type: 'success' as const },
  { id: '2', time: new Date(Date.now() - 1000*120).toISOString(), icon: <FileText className="h-3.5 w-3.5" />, text: '견적서 자동 생성 — 현대모비스 PoC 견적', type: 'info' as const },
  { id: '3', time: new Date(Date.now() - 1000*300).toISOString(), icon: <CheckCircle2 className="h-3.5 w-3.5" />, text: 'Color Review 통과 — 삼성SDS 기술검토 ✅', type: 'success' as const },
  { id: '4', time: new Date(Date.now() - 1000*600).toISOString(), icon: <AlertTriangle className="h-3.5 w-3.5" />, text: '리스크 감지 — 신한은행 Deal 할인율 22% 초과', type: 'warning' as const },
  { id: '5', time: new Date(Date.now() - 1000*1800).toISOString(), icon: <CheckCircle2 className="h-3.5 w-3.5" />, text: '메일 분류 완료 — KT 유지보수 제안서 → AI 검토 중', type: 'info' as const },
]

const SALES_STATS = [
  { label: 'AI 처리 오늘', value: '12건', type: 'success' as const },
  { label: '승인 대기', value: '2건', type: 'warning' as const },
  { label: 'Pipeline 총액', value: '₩2.4B', type: 'default' as const },
  { label: '예외 케이스', value: '1건', type: 'error' as const },
]

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
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">Failed to load dashboard</h2>
      <p className="text-sm text-red-600 dark:text-red-300">{message}</p>
    </div>
  );
}

const handleCommand = async (command: string) => {
  console.log('AI Command:', command)
  // 실제 API 연동은 추후
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
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const totalPipeline = data?.pipeline.reduce((s, o) => s + o.value, 0) ?? 0;

  return (
    <AIWorkspaceLayout
      title="Sales"
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
                <CardDescription>Sales pipeline by stage and weighted forecast</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data?.pipeline.length ? (
                  <>
                    <MetricRow label="열린 기회" value={String(data.pipeline.length)} />
                    <MetricRow label="가중 예상 매출" value={`$${(totalPipeline * 0.4).toLocaleString()}`} />
                    <MetricRow label="Pipeline total" value={`$${totalPipeline.toLocaleString()}`} />
                  </>
                ) : (
                  <p className="py-4 text-center text-sm text-muted-foreground">No pipeline data</p>
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
                  <>
                    <MetricRow label="Discovery follow-up" value={String(data.followUp)} />
                    <MetricRow label="미팅 예정" value="3" />
                    <MetricRow label="이메일 작성" value="7" />
                  </>
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
                    <MetricRow label="$50K+ quote deals" value={String(data.riskDeals)} />
                    <MetricRow label="Stage changes" value={String(data.pipeline.filter((o) => o.stage === "quote").length)} />
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
