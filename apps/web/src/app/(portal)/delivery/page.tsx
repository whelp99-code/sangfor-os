"use client";

import { useEffect, useState } from "react";
import { Calendar, FileSignature, Key, ClipboardCheck, FileText, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AIWorkspaceLayout } from "@/components/ai-workspace";
import { ActivityItem } from "@/components/ai-workspace/ai-activity-feed";

type DeliveryData = {
  upcomingDeployments: number;
  sowConfirmation: number;
  licenseActivation: number;
  acceptanceChecklist: number;
  handoverDocs: number;
};

const deliveryActivities: ActivityItem[] = [];

const deliveryStats: { label: string; value: string; type: "success" | "warning" | "error" | "default" }[] = [];

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

export default function DeliveryDashboardPage() {
  const [data, setData] = useState<DeliveryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/dashboard/delivery");
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

  async function handleCommand(_cmd: string) {
    // TODO(oma-deferred): wire the delivery AI assistant when the endpoint is provisioned.
    return "AI 어시스턴트는 준비 중입니다";
  }

  return (
    <AIWorkspaceLayout
      title="딜리버리"
      subtitle="역할 기반 운영 대시보드"
      activities={deliveryActivities}
      stats={deliveryStats}
      onCommand={handleCommand}
    >
      {loading && <LoadingSkeleton />}
      {error && <ErrorState message={error} />}
      {!loading && !error && (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-base">구축 예정</CardTitle>
            </div>
            <CardDescription>다가오는 구축 일정</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data ? (
              <MetricRow label="예정 건수" value={String(data.upcomingDeployments)} />
            ) : null}
            {!data?.upcomingDeployments && (
              <p className="py-4 text-center text-sm text-muted-foreground">기록 없음</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-emerald-600" />
              <CardTitle className="text-base">SOW 확인 필요</CardTitle>
            </div>
            <CardDescription>확인 대기 중인 작업 명세서</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data ? (
              <MetricRow label="확인 대기" value={String(data.sowConfirmation)} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="h-5 w-5 text-amber-600" />
              <CardTitle className="text-base">라이선스 활성화 필요</CardTitle>
            </div>
            <CardDescription>활성화 대기 중인 라이선스</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data ? (
              <MetricRow label="미활성" value={String(data.licenseActivation)} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-purple-600" />
              <CardTitle className="text-base">검수 체크리스트</CardTitle>
            </div>
            <CardDescription>고객 승인 대기 항목</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data ? (
              <MetricRow label="진행 중" value={String(data.acceptanceChecklist)} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-600" />
              <CardTitle className="text-base">인수인계 문서</CardTitle>
            </div>
            <CardDescription>인수인계 문서 상태</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data ? (
              <MetricRow label="작성 필요" value={String(data.handoverDocs)} />
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
