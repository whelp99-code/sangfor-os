"use client";

import { useEffect, useState } from "react";
import {
  Users,
  ListChecks,
  CalendarCheck,
  FlaskConical,
  TrendingUp,
  Mail,
  Activity,
  Server,
  BarChart3,
  Clock,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  KpiSparkline,
  PipelineChart,
  ActivityChart,
  HealthDonut,
} from "./charts";

interface DashboardData {
  summary: {
    customers: number;
    openTasks: number;
    todayTasks: number;
    activePocs: number;
    approvals: {
      mailCandidates: number;
      automation: number;
    };
    opportunities: {
      byStage: Record<string, number>;
    };
  };
  dailyReport: {
    mail: {
      todayCandidates: number;
      pendingApproval: number;
      todayApproved: number;
      todayConverted: number;
    };
    entities: {
      customers: number;
      partners: number;
      tasks: number;
      opportunities: number;
    };
  };
  health: {
    overall: "ok" | "degraded";
    services: { name: string; status: "ok" | "error" | "degraded" }[];
  };
  activity: {
    dates: string[];
    tasks: number[];
    approvals: number[];
    mails: number[];
  };
}

// Mock sparkline data (in production, fetch from API)
const generateSparklineData = (base: number, points = 7) =>
  Array.from({ length: points }, (_, i) => ({
    date: `${i + 1}일전`,
    value: Math.max(0, base + Math.floor(Math.random() * 20 - 10)),
  }));

export function RedesignedDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const [summaryRes, reportRes, healthRes] = await Promise.all([
          fetch("/api/summary").catch(() => null),
          fetch("/api/daily-report").catch(() => null),
          fetch("/api/aios-v3-status").catch(() => null),
        ]);

        const summary = summaryRes?.ok ? await summaryRes.json() : null;
        const report = reportRes?.ok ? await reportRes.json() : null;
        const health = healthRes?.ok ? await healthRes.json() : null;

        // Generate mock activity data for demonstration
        const dates = Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - (6 - i));
          return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
        });

        setData({
          summary: summary || {
            customers: 0,
            openTasks: 0,
            todayTasks: 0,
            activePocs: 0,
            approvals: { mailCandidates: 0, automation: 0 },
            opportunities: { byStage: {} },
          },
          dailyReport: report || {
            mail: {
              todayCandidates: 0,
              pendingApproval: 0,
              todayApproved: 0,
              todayConverted: 0,
            },
            entities: { customers: 0, partners: 0, tasks: 0, opportunities: 0 },
          },
          health: health || { overall: "ok", services: [] },
          activity: {
            dates,
            tasks: dates.map(() => Math.floor(Math.random() * 10) + 1),
            approvals: dates.map(() => Math.floor(Math.random() * 5)),
            mails: dates.map(() => Math.floor(Math.random() * 15) + 5),
          },
        });
      } catch (err) {
        console.error("Dashboard data fetch error:", err);
        // Set default data even on error
        const dates = Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - (6 - i));
          return d.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
        });
        setData({
          summary: {
            customers: 0,
            openTasks: 0,
            todayTasks: 0,
            activePocs: 0,
            approvals: { mailCandidates: 0, automation: 0 },
            opportunities: { byStage: {} },
          },
          dailyReport: {
            mail: {
              todayCandidates: 0,
              pendingApproval: 0,
              todayApproved: 0,
              todayConverted: 0,
            },
            entities: { customers: 0, partners: 0, tasks: 0, opportunities: 0 },
          },
          health: { overall: "ok", services: [] },
          activity: {
            dates,
            tasks: dates.map(() => Math.floor(Math.random() * 10) + 1),
            approvals: dates.map(() => Math.floor(Math.random() * 5)),
            mails: dates.map(() => Math.floor(Math.random() * 15) + 5),
          },
        });
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="space-y-8">
        <div className="h-32 animate-pulse rounded-2xl bg-muted" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const pipelineData = Object.entries(data.summary.opportunities.byStage).map(
    ([stage, count]) => ({ stage, count }),
  );

  return (
    <div className="space-y-8">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-6 text-white shadow-xl sm:p-8">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
        <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-blue-500/10 blur-2xl" />
        <div className="relative">
          <p className="text-sm font-medium text-gray-400">AI Work Portal</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
            대시보드
          </h1>
          <p className="mt-2 text-sm text-gray-400">
            프로젝트 현황을 한눈에 파악하세요
          </p>
        </div>
      </div>

      {/* KPI Cards with Sparklines */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiSparkline
          title="고객사"
          value={data.summary.customers}
          previousValue={data.summary.customers - 2}
          data={generateSparklineData(data.summary.customers)}
          color="blue"
          icon={Users}
        />
        <KpiSparkline
          title="미완료 작업"
          value={data.summary.openTasks}
          previousValue={data.summary.openTasks + 3}
          data={generateSparklineData(data.summary.openTasks)}
          color="amber"
          icon={ListChecks}
        />
        <KpiSparkline
          title="오늘 작업"
          value={data.summary.todayTasks}
          previousValue={data.summary.todayTasks - 1}
          data={generateSparklineData(data.summary.todayTasks)}
          color="emerald"
          icon={CalendarCheck}
        />
        <KpiSparkline
          title="활성 PoC"
          value={data.summary.activePocs}
          data={generateSparklineData(data.summary.activePocs)}
          color="purple"
          icon={FlaskConical}
        />
      </div>

      {/* Tabs for different views */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-[400px]">
          <TabsTrigger value="overview">개요</TabsTrigger>
          <TabsTrigger value="activity">활동</TabsTrigger>
          <TabsTrigger value="pipeline">파이프라인</TabsTrigger>
          <TabsTrigger value="system">시스템</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Mail Status */}
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
                  <Mail className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                </div>
                <CardTitle className="text-sm font-medium">
                  메일 처리 현황
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <StatItem
                    icon={<Clock className="h-3.5 w-3.5" />}
                    label="오늘 신규"
                    value={data.dailyReport.mail.todayCandidates}
                    unit="건"
                    color="blue"
                  />
                  <StatItem
                    icon={<Mail className="h-3.5 w-3.5" />}
                    label="승인 대기"
                    value={data.dailyReport.mail.pendingApproval}
                    unit="건"
                    color="amber"
                  />
                  <StatItem
                    icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                    label="오늘 승인"
                    value={data.dailyReport.mail.todayApproved}
                    unit="건"
                    color="emerald"
                  />
                  <StatItem
                    icon={<TrendingUp className="h-3.5 w-3.5" />}
                    label="오늘 변환"
                    value={data.dailyReport.mail.todayConverted}
                    unit="건"
                    color="purple"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Entity Summary */}
            <Card className="transition-shadow hover:shadow-md">
              <CardHeader className="flex flex-row items-center gap-2 pb-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/50">
                  <TrendingUp className="h-4 w-4 text-violet-600 dark:text-violet-400" />
                </div>
                <CardTitle className="text-sm font-medium">
                  생성된 엔티티
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-3">
                  <StatItem
                    icon={<Users className="h-3.5 w-3.5" />}
                    label="고객"
                    value={data.dailyReport.entities.customers}
                    unit="개"
                    color="blue"
                  />
                  <StatItem
                    icon={<Users className="h-3.5 w-3.5" />}
                    label="파트너"
                    value={data.dailyReport.entities.partners}
                    unit="개"
                    color="emerald"
                  />
                  <StatItem
                    icon={<ListChecks className="h-3.5 w-3.5" />}
                    label="작업"
                    value={data.dailyReport.entities.tasks}
                    unit="개"
                    color="amber"
                  />
                  <StatItem
                    icon={<TrendingUp className="h-3.5 w-3.5" />}
                    label="기회"
                    value={data.dailyReport.entities.opportunities}
                    unit="개"
                    color="purple"
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Approval Queue */}
          {(data.summary.approvals.mailCandidates > 0 ||
            data.summary.approvals.automation > 0) && (
            <Card className="border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/50">
                    <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  </div>
                  <CardTitle className="text-base">승인 대기열</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
                <div className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
                  <span className="text-muted-foreground">
                    메일 후보 승인 대기
                  </span>
                  <Badge variant="outline">
                    {data.summary.approvals.mailCandidates}
                  </Badge>
                </div>
                <div className="flex items-center justify-between rounded-lg border bg-background/80 px-3 py-2.5">
                  <span className="text-muted-foreground">자동화 승인</span>
                  <Badge variant="outline">
                    {data.summary.approvals.automation}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity">
          <ActivityChart
            title="주간 활동 추이"
            data={data.activity.dates.map((date, i) => ({
              date,
              tasks: data.activity.tasks[i],
              approvals: data.activity.approvals[i],
              mails: data.activity.mails[i],
            }))}
            series={[
              { key: "tasks", label: "작업", color: "#3b82f6" },
              { key: "approvals", label: "승인", color: "#10b981" },
              { key: "mails", label: "메일", color: "#8b5cf6" },
            ]}
            xAxisKey="date"
            icon={Activity}
          />
        </TabsContent>

        {/* Pipeline Tab */}
        <TabsContent value="pipeline">
          {pipelineData.length > 0 ? (
            <PipelineChart
              title="영업기회 파이프라인"
              data={pipelineData}
              icon={BarChart3}
            />
          ) : (
            <Card>
              <CardContent className="flex h-40 items-center justify-center text-muted-foreground">
                파이프라인 데이터가 없습니다
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* System Tab */}
        <TabsContent value="system">
          <HealthDonut
            title="시스템 상태"
            services={data.health.services}
            icon={Server}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Helper Components ── */

const STAT_COLORS = {
  blue: "bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-400",
  emerald:
    "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400",
  amber:
    "bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400",
  purple:
    "bg-purple-50 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400",
} as const;

function StatItem({
  icon,
  label,
  value,
  unit,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  unit: string;
  color: keyof typeof STAT_COLORS;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/30 p-2.5">
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${STAT_COLORS[color]}`}
      >
        {icon}
      </div>
      <div>
        <p className="text-lg font-bold leading-none">{value}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {label} {unit}
        </p>
      </div>
    </div>
  );
}
