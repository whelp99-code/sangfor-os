"use client";

import { useCallback, useEffect, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";

import { cn } from "@/lib/utils";

type Sample = { ts: string; status: string; latencyMs?: number };
type TargetStats = { id: string; current: string; uptimePct: number; avgLatencyMs: number | null; samples: number };
type Snapshot = { id: string; stats: TargetStats; series: Sample[] };

const TARGET_LABELS: Record<string, string> = {
  "whelp99-code-sangfor-engineer-mcp": "MCP 브릿지",
  "sangfor-mcp-workflow": "워크플로우 콘솔",
  "sangfor-engineer-operator-console": "Engineer 콘솔",
  "sangfor-mock-console": "Mock 콘솔",
};

function uptimeColor(pct: number): string {
  if (pct >= 99) return "text-emerald-600 dark:text-emerald-400";
  if (pct >= 90) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

export function HealthTrends() {
  const [targets, setTargets] = useState<Snapshot[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/integrations/history", { cache: "no-store" });
      const json = await res.json();
      setTargets(json.targets ?? []);
    } catch {
      /* non-fatal */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (loaded && targets.length === 0) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        아직 수집된 추이가 없습니다. 헬스 프로브가 누적되면 표시됩니다.
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {targets.map((t) => {
        const rows = t.series.map((s, i) => ({
          i,
          latency: s.status === "unreachable" ? 0 : s.latencyMs ?? 0,
          status: s.status,
        }));
        return (
          <div key={t.id} className="rounded-md border border-border p-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="truncate text-xs font-semibold">{TARGET_LABELS[t.id] ?? t.id}</span>
              <span className={cn("font-mono text-xs font-semibold", uptimeColor(t.stats.uptimePct))}>
                {t.stats.uptimePct}% up
              </span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <span>평균 {t.stats.avgLatencyMs ?? "—"}ms</span>
              <span>· {t.stats.samples} 샘플</span>
            </div>
            <div className="mt-2 h-16" aria-hidden="true">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={rows} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`lat-${t.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={[0, "dataMax + 10"]} />
                  <Tooltip
                    formatter={(value) => `${Number(value)}ms`}
                    labelFormatter={() => ""}
                    contentStyle={{ fontSize: 11 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="latency"
                    stroke="#6366f1"
                    strokeWidth={1.5}
                    fill={`url(#lat-${t.id})`}
                    isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
