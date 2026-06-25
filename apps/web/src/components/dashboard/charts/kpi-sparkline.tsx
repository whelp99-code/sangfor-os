"use client";

import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";

import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface KpiSparklineProps {
  title: string;
  value: number;
  previousValue?: number;
  unit?: string;
  data: { date: string; value: number }[];
  color?: "blue" | "emerald" | "amber" | "purple" | "red" | "slate";
  icon?: React.ComponentType<{ className?: string }>;
}

const COLOR_CONFIG = {
  blue: {
    gradient: ["#3b82f6", "#93c5fd"],
    text: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    iconBg: "bg-blue-100 dark:bg-blue-900/50",
  },
  emerald: {
    gradient: ["#10b981", "#6ee7b7"],
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    iconBg: "bg-emerald-100 dark:bg-emerald-900/50",
  },
  amber: {
    gradient: ["#f59e0b", "#fcd34d"],
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    iconBg: "bg-amber-100 dark:bg-amber-900/50",
  },
  purple: {
    gradient: ["#8b5cf6", "#c4b5fd"],
    text: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    iconBg: "bg-purple-100 dark:bg-purple-900/50",
  },
  red: {
    gradient: ["#ef4444", "#fca5a5"],
    text: "text-red-600 dark:text-red-400",
    bg: "bg-red-50 dark:bg-red-950/30",
    iconBg: "bg-red-100 dark:bg-red-900/50",
  },
  slate: {
    gradient: ["#64748b", "#cbd5e1"],
    text: "text-slate-600 dark:text-slate-400",
    bg: "bg-slate-50 dark:bg-slate-950/30",
    iconBg: "bg-slate-100 dark:bg-slate-900/50",
  },
} as const;

export function KpiSparkline({
  title,
  value,
  previousValue,
  unit = "",
  data,
  color = "blue",
  icon: Icon,
}: KpiSparklineProps) {
  const config = COLOR_CONFIG[color];
  const change =
    previousValue !== undefined && previousValue !== 0
      ? ((value - previousValue) / previousValue) * 100
      : null;
  const isPositive = change !== null && change > 0;
  const isNeutral = change === null || change === 0;

  return (
    <Card className="relative overflow-hidden transition-shadow hover:shadow-md">
      <CardContent className="pt-4 pb-0">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl font-bold tracking-tight">
                {value.toLocaleString()}
              </span>
              {unit && (
                <span className="text-sm text-muted-foreground">{unit}</span>
              )}
            </div>
            {change !== null && (
              <div className="flex items-center gap-1 text-xs">
                {isNeutral ? (
                  <Minus className="h-3 w-3 text-muted-foreground" />
                ) : isPositive ? (
                  <TrendingUp className="h-3 w-3 text-emerald-500" />
                ) : (
                  <TrendingDown className="h-3 w-3 text-red-500" />
                )}
                <span
                  className={
                    isNeutral
                      ? "text-muted-foreground"
                      : isPositive
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                  }
                >
                  {isPositive ? "+" : ""}
                  {change.toFixed(1)}%
                </span>
                <span className="text-muted-foreground">vs 이전</span>
              </div>
            )}
          </div>
          {Icon && (
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${config.iconBg}`}
            >
              <Icon className={`h-5 w-5 ${config.text}`} />
            </div>
          )}
        </div>
      </CardContent>
      <div className="h-16 px-2">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data}>
            <defs>
              <linearGradient
                id={`gradient-${color}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="0%"
                  stopColor={config.gradient[0]}
                  stopOpacity={0.3}
                />
                <stop
                  offset="100%"
                  stopColor={config.gradient[1]}
                  stopOpacity={0}
                />
              </linearGradient>
            </defs>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload?.[0]) {
                  return (
                    <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-md">
                      <p className="font-medium">{payload[0].payload.date}</p>
                      <p className={config.text}>
                        {payload[0].value?.toLocaleString()}
                        {unit}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={config.gradient[0]}
              strokeWidth={2}
              fill={`url(#gradient-${color})`}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
