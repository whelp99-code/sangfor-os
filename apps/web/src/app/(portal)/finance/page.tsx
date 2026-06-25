"use client";

import { useEffect, useState } from "react";
import { ClipboardList, TrendingDown, Percent, Diff, CreditCard, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABELS } from "@sangfor/shared";

type FinanceData = {
  commercialApprovalQueue: number;
  lowMarginDeals: number;
  highDiscountRequests: number;
  quoteDiffs: number;
  exceptionPayments: number;
};

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

  if (loading) return <LoadingSkeleton />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-xl sm:p-8">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-blue-500/10 blur-2xl" />
        <div className="relative">
          <p className="text-sm font-medium text-gray-400">Sangfor Agentic OS</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Finance Manager</h1>
          <p className="mt-2 text-sm text-gray-400">Role-based operational dashboard</p>
        </div>
      </div>

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
            {data ? (
              <MetricRow label="마진 15% 미만" value={String(data.lowMarginDeals)} />
            ) : null}
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
            {data ? (
              <MetricRow label="30% 초과" value={String(data.highDiscountRequests)} />
            ) : null}
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
            {data ? (
              <MetricRow label="견적 초과" value={String(data.quoteDiffs)} />
            ) : null}
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
            {data ? (
              <MetricRow label="예외 건수" value={String(data.exceptionPayments)} />
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
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
