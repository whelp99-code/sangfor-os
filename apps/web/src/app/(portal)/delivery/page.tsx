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

const deliveryActivities: ActivityItem[] = [
  { id: "d1", time: new Date(Date.now() - 1000 * 60 * 5).toISOString(), text: "구축 일정 자동 조정 완료: 고객 A사 일정 2일 단축", type: "success" },
  { id: "d2", time: new Date(Date.now() - 1000 * 60 * 30).toISOString(), text: "SOW 검토 중: B사 계약서 조항 3건 플래그", type: "warning" },
  { id: "d3", time: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), text: "자재 발주 완료: C사 스위치 12대 주문 생성", type: "success" },
  { id: "d4", time: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), text: "인수 일정 알림: D사 FAT 테스트 3일 전", type: "info" },
];

const deliveryStats = [
  { label: "구축 예정", value: "4건", type: "default" as const },
  { label: "SOW 확인 대기", value: "2건", type: "warning" as const },
  { label: "라이선스 미활성", value: "1건", type: "error" as const },
  { label: "인수 진행 중", value: "3건", type: "success" as const },
];

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
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">Failed to load dashboard</h2>
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
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  function handleCommand(cmd: string) {
    console.log("[Delivery] CEO command:", cmd);
  }

  return (
    <AIWorkspaceLayout
      title="Delivery Engineer"
      subtitle="Role-based operational dashboard"
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
            <CardDescription>Upcoming deployment schedules</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data ? (
              <MetricRow label="예정 건수" value={String(data.upcomingDeployments)} />
            ) : null}
            {!data?.upcomingDeployments && (
              <p className="py-4 text-center text-sm text-muted-foreground">No upcoming deployments</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-emerald-600" />
              <CardTitle className="text-base">SOW 확인 필요</CardTitle>
            </div>
            <CardDescription>Statement of Work pending confirmation</CardDescription>
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
              <CardTitle className="text-base">License Activation 필요</CardTitle>
            </div>
            <CardDescription>Pending license activations</CardDescription>
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
              <CardTitle className="text-base">Acceptance Checklist</CardTitle>
            </div>
            <CardDescription>Items awaiting customer sign-off</CardDescription>
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
              <CardTitle className="text-base">Handover 문서</CardTitle>
            </div>
            <CardDescription>Handover documentation status</CardDescription>
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
