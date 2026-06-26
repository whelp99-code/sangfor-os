"use client";

import { useEffect, useState } from "react";
import {
  ClipboardList,
  TrendingDown,
  Percent,
  Diff,
  CreditCard,
  AlertTriangle,
  Calculator,
  Receipt,
  FileCheck,
  Landmark,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABELS } from "@sangfor/shared";
import { AIWorkspaceLayout } from "@/components/ai-workspace";

type FinanceData = {
  commercialApprovalQueue: number;
  lowMarginDeals: number;
  highDiscountRequests: number;
  quoteDiffs: number;
  exceptionPayments: number;
};

// Mock AI activities for Finance
const FINANCE_ACTIVITIES = [
  {
    id: "1",
    time: new Date(Date.now() - 1000 * 30).toISOString(),
    icon: <Calculator className="h-3.5 w-3.5" />,
    text: "정산 자동 처리 — 6월 마감 정산 12건 완료",
    type: "success" as const,
  },
  {
    id: "2",
    time: new Date(Date.now() - 1000 * 120).toISOString(),
    icon: <FileCheck className="h-3.5 w-3.5" />,
    text: "송장 검증 완료 — 현대모비스 입금 확인 ✅",
    type: "success" as const,
  },
  {
    id: "3",
    time: new Date(Date.now() - 1000 * 300).toISOString(),
    icon: <Receipt className="h-3.5 w-3.5" />,
    text: "VAT 계산 — 삼성SDS 거래 10% 세금 계산 완료",
    type: "info" as const,
  },
  {
    id: "4",
    time: new Date(Date.now() - 1000 * 600).toISOString(),
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    text: "컨디션 리스크 감지 — 신한은행 지연 Payment 3일 초과",
    type: "warning" as const,
  },
  {
    id: "5",
    time: new Date(Date.now() - 1000 * 1800).toISOString(),
    icon: <Landmark className="h-3.5 w-3.5" />,
    text: "예산 초과 알림 — KT 프로젝트 컨설팅 비용 한도 도달",
    type: "warning" as const,
  },
];

const FINANCE_STATS = [
  { label: "오늘 처리 건수", value: "24건", type: "success" as const },
  { label: "승인 대기", value: "3건", type: "warning" as const },
  { label: "예외 케이스", value: "2건", type: "error" as const },
  { label: "총 처리 금액", value: "₩1.8B", type: "default" as const },
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

const handleCommand = async (command: string) => {
  console.log("AI Command:", command);
  // 실제 API 연동은 추후
};

export default function FinanceDashboardPage() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/dashboard/finance");
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

  return (
    <AIWorkspaceLayout
      title="Finance"
      subtitle="AI가 재무 정산 및 송장 검증을 자동 관리합니다"
      activities={FINANCE_ACTIVITIES}
      stats={FINANCE_STATS}
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
                  <ClipboardList className="h-5 w-5 text-blue-600" />
                  <CardTitle className="text-base">Commercial Approval Queue</CardTitle>
                </div>
                <CardDescription>Pending financial approvals</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? (
                  <>
                    <MetricRow label="승인 대기" value={String(data.commercialApprovalQueue)} />
                    <MetricRow label="상태" value={STATUS_LABELS.ready_for_human_approval} />
                  </>
                ) : null}
                {!data?.commercialApprovalQueue && (
                  <p className="py-4 text-center text-sm text-muted-foreground">Approval queue is clear</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-red-600" />
                  <CardTitle className="text-base">낮은 마진 딜</CardTitle>
                </div>
                <CardDescription>Deals below margin threshold</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? <MetricRow label="마진 15% 미만" value={String(data.lowMarginDeals)} /> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Percent className="h-5 w-5 text-amber-600" />
                  <CardTitle className="text-base">높은 할인 요청</CardTitle>
                </div>
                <CardDescription>Discount requests exceeding policy</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? <MetricRow label="30% 초과" value={String(data.highDiscountRequests)} /> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Diff className="h-5 w-5 text-purple-600" />
                  <CardTitle className="text-base">견적 Diff</CardTitle>
                </div>
                <CardDescription>Quote vs actual discrepancies</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? <MetricRow label="견적 초과" value={String(data.quoteDiffs)} /> : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-indigo-600" />
                  <CardTitle className="text-base">예외 Payment Term</CardTitle>
                </div>
                <CardDescription>Non-standard payment term requests</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {data ? <MetricRow label="예외 건수" value={String(data.exceptionPayments)} /> : null}
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
