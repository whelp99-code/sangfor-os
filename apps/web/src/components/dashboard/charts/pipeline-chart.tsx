"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

interface PipelineData {
  stage: string;
  count: number;
  value?: number;
}

interface PipelineChartProps {
  title: string;
  data: PipelineData[];
  icon?: React.ComponentType<{ className?: string }>;
  valueLabel?: string;
}

const BAR_COLORS = [
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#f97316", // orange
];

export function PipelineChart({
  title,
  data,
  icon: Icon = BarChart3,
  valueLabel = "건",
}: PipelineChartProps) {
  const chartData = data.map((item, index) => ({
    ...item,
    fill: BAR_COLORS[index % BAR_COLORS.length],
  }));

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="flex flex-row items-center gap-2 pb-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
          <Icon className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                className="stroke-muted"
                horizontal={false}
              />
              <XAxis type="number" className="text-xs" tick={{ fontSize: 12 }} />
              <YAxis
                type="category"
                dataKey="stage"
                className="text-xs"
                tick={{ fontSize: 12 }}
                width={70}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload?.[0]) {
                    const data = payload[0].payload as PipelineData;
                    return (
                      <div className="rounded-lg border bg-background px-3 py-2 text-sm shadow-md">
                        <p className="font-medium">{data.stage}</p>
                        <p className="text-muted-foreground">
                          {data.count}
                          {valueLabel}
                          {data.value !== undefined && (
                            <span className="ml-2">
                              ({(data.value / 1000000).toFixed(1)}M)
                            </span>
                          )}
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
