"use client";

import { useEffect, useState, useCallback } from "react";
import { Search, CheckSquare, Ruler, FlaskConical, FileText, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABELS } from "@sangfor/shared";
import { AIWorkspaceLayout } from "@/components/ai-workspace/ai-workspace-layout";
import { ActivityItem } from "@/components/ai-workspace/ai-activity-feed";

type PresalesData = {
  pendingDiscovery: number;
  solutionFitReview: number;
  missingSizing: number;
  pocPrep: number;
  aiDraftReview: number;
};

const MOCK_ACTIVITIES: ActivityItem[] = [];

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="h-32 animate-pulse rounded-2xl bg-muted" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[1, 2, 3, 4, 5].map((i) => (
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

export default function PresalesDashboardPage() {
  const [data, setData] = useState<PresalesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/dashboard/presales");
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

  const handleCommand = useCallback((cmd: string) => {
    console.log("[Presales AI Command]", cmd);
  }, []);

  const stats = [
    { label: "오늘 분석 건수", value: data ? String(data.pendingDiscovery + data.solutionFitReview) : "-", type: "default" as const },
    { label: "검토 대기", value: data ? String(data.solutionFitReview) : "-", type: "warning" as const },
    { label: "PoC 진행중", value: data ? String(data.pocPrep) : "-", type: "default" as const },
    { label: "AI Draft 대기", value: data ? String(data.aiDraftReview) : "-", type: "default" as const },
  ];

  return (
    <AIWorkspaceLayout
      title="프리세일즈"
      subtitle="역할 기반 운영 대시보드"
      activities={MOCK_ACTIVITIES}
      stats={stats}
      onCommand={handleCommand}
    >
      {loading && <LoadingSkeleton />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (
        <div className="space-y-6">
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-xl sm:p-8">
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
            <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-blue-500/10 blur-2xl" />
            <div className="relative">
              <p className="text-sm font-medium text-gray-400">Sangfor Agentic OS</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">프리세일즈</h1>
              <p className="mt-2 text-sm text-gray-400">역할 기반 운영 대시보드</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Search className="h-5 w-5 text-blue-600" />
                  <CardTitle className="text-base">Discovery 대기</CardTitle>
                </div>
                <CardDescription>Opportunities awaiting technical discovery</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? (
                  <MetricRow label="신규 요청" value={String(data.pendingDiscovery)} />
                ) : null}
                {!data?.pendingDiscovery && !data?.solutionFitReview && (
                  <p className="py-4 text-center text-sm text-muted-foreground">No discovery requests pending</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CheckSquare className="h-5 w-5 text-emerald-600" />
                  <CardTitle className="text-base">Solution Fit 검토</CardTitle>
                </div>
                <CardDescription>Pending solution architecture reviews</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? (
                  <MetricRow label="검토 대기" value={String(data.solutionFitReview)} />
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Ruler className="h-5 w-5 text-amber-600" />
                  <CardTitle className="text-base">Sizing 누락 항목</CardTitle>
                </div>
                <CardDescription>Quotes missing sizing data</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? (
                  <MetricRow label="누락" value={String(data.missingSizing)} />
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FlaskConical className="h-5 w-5 text-purple-600" />
                  <CardTitle className="text-base">PoC 준비</CardTitle>
                </div>
                <CardDescription>PoC preps requiring attention</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? (
                  <MetricRow label="Planning" value={String(data.pocPrep)} />
                ) : null}
                {!data?.pocPrep && (
                  <p className="py-4 text-center text-sm text-muted-foreground">No active PoC preps</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <FileText className="h-5 w-5 text-indigo-600" />
                  <CardTitle className="text-base">AI Draft 검토 필요</CardTitle>
                </div>
                <CardDescription>AI-generated technical drafts pending human review</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? (
                  <>
                    <MetricRow label="검토 대기" value={String(data.aiDraftReview)} />
                    <MetricRow label="Approval status" value={STATUS_LABELS.ready_for_human_approval} />
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
