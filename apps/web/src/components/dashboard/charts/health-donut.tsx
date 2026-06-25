"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";

interface HealthData {
  name: string;
  value: number;
  status: "ok" | "error" | "degraded";
}

interface HealthDonutProps {
  title: string;
  services: { name: string; status: "ok" | "error" | "degraded" }[];
  icon?: React.ComponentType<{ className?: string }>;
}

const STATUS_COLORS = {
  ok: "#10b981",
  degraded: "#f59e0b",
  error: "#ef4444",
};

export function HealthDonut({
  title,
  services,
  icon: Icon,
}: HealthDonutProps) {
  const statusCounts = services.reduce(
    (acc, svc) => {
      acc[svc.status] = (acc[svc.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const chartData: HealthData[] = [
    { name: "정상", value: statusCounts.ok || 0, status: "ok" as const },
    { name: "degraded", value: statusCounts.degraded || 0, status: "degraded" as const },
    { name: "오류", value: statusCounts.error || 0, status: "error" as const },
  ].filter((d) => d.value > 0);

  const total = services.length;
  const healthy = statusCounts.ok || 0;
  const healthPercent = total > 0 ? Math.round((healthy / total) * 100) : 0;

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/50">
          {Icon && (
            <Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          )}
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          <div className="h-[140px] w-[140px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={65}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={STATUS_COLORS[entry.status]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload?.[0]) {
                      const data = payload[0].payload as HealthData;
                      return (
                        <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-md">
                          <p className="font-medium">{data.name}</p>
                          <p className="text-muted-foreground">
                            {data.value}개 서비스
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex-1 space-y-3">
            <div>
              <p className="text-3xl font-bold">{healthPercent}%</p>
              <p className="text-sm text-muted-foreground">서비스 가용성</p>
            </div>
            <div className="space-y-1.5">
              {services.slice(0, 5).map((svc) => (
                <div
                  key={svc.name}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="truncate text-muted-foreground">
                    {svc.name}
                  </span>
                  {svc.status === "ok" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" role="img" aria-label={`${svc.name} status OK`} />
                  ) : svc.status === "degraded" ? (
                    <AlertTriangle className="h-4 w-4 text-amber-500" role="img" aria-label={`${svc.name} status degraded`} />
                  ) : (
                    <XCircle className="h-4 w-4 text-red-500" role="img" aria-label={`${svc.name} status error`} />
                  )}
                </div>
              ))}
              {services.length > 5 && (
                <p className="text-xs text-muted-foreground">
                  +{services.length - 5}개 더보기
                </p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
