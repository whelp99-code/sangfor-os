"use client";

import { useEffect, useState } from "react";
import { Ticket, Timer, ArrowUpRight, FileSearch, Repeat, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AIWorkspaceLayout } from "@/components/ai-workspace";
import { ActivityItem } from "@/components/ai-workspace/ai-activity-feed";

type SupportData = {
  newTickets: number;
  slaDeadlines: number;
  vendorEscalations: number;
  rcaRequired: number;
  repeatIssues: number;
};

const supportActivities: ActivityItem[] = [];

const supportStats: { label: string; value: string; type: "success" | "warning" | "error" | "default" }[] = [];

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

export default function SupportDashboardPage() {
  const [data, setData] = useState<SupportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/dashboard/support");
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
    console.log("[Support] CEO command:", cmd);
  }

  return (
    <AIWorkspaceLayout
      title="Support Engineer"
      subtitle="Role-based operational dashboard"
      activities={supportActivities}
      stats={supportStats}
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
              <Ticket className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-base">신규 Ticket</CardTitle>
            </div>
            <CardDescription>New support tickets today</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data && data.newTickets > 0 ? (
              <MetricRow label="열린 티켓" value={String(data.newTickets)} />
            ) : null}
            {data && !data.newTickets && (
              <p className="py-4 text-center text-sm text-muted-foreground">No open tickets</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Timer className="h-5 w-5 text-red-600" />
              <CardTitle className="text-base">SLA 임박</CardTitle>
            </div>
            <CardDescription>Tickets approaching SLA deadlines</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data ? (
              <MetricRow label="임박 건수" value={String(data.slaDeadlines)} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ArrowUpRight className="h-5 w-5 text-amber-600" />
              <CardTitle className="text-base">Vendor Escalation</CardTitle>
            </div>
            <CardDescription>Escalations to Sangfor HQ / third-party</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data ? (
              <MetricRow label="에스컬레이션" value={String(data.vendorEscalations)} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileSearch className="h-5 w-5 text-purple-600" />
              <CardTitle className="text-base">RCA 작성 필요</CardTitle>
            </div>
            <CardDescription>Tickets requiring Root Cause Analysis</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data ? (
              <MetricRow label="미작성" value={String(data.rcaRequired)} />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Repeat className="h-5 w-5 text-indigo-600" />
              <CardTitle className="text-base">반복 장애 고객</CardTitle>
            </div>
            <CardDescription>Customers with recurring issues</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data ? (
              <MetricRow label="3회 이상" value={String(data.repeatIssues)} />
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
