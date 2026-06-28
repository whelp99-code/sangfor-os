"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ServerCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { STATUS_META, StatusPill, normalizeStatus, type IntegrationStatus } from "./status-ui";

type Target = {
  id: string;
  status: string;
  upstream: string;
  details?: string;
  readinessNote?: string;
  latencyMs?: number;
};

type HealthResponse = {
  overall: "ok" | "degraded" | "error";
  summary?: { total: number; healthy: number; degraded: number; unreachable: number; unknown: number };
  targets: Target[];
  error?: string;
  timestamp?: string;
};

/** Friendly display names for the registered integration target ids. */
const TARGET_LABELS: Record<string, string> = {
  "whelp99-code-sangfor-engineer-mcp": "MCP 브릿지 (Engineer)",
  "sangfor-mcp-workflow": "워크플로우 콘솔",
  "sangfor-engineer-operator-console": "Engineer 운영 콘솔",
  "sangfor-mock-console": "Mock 콘솔",
};

const REFRESH_INTERVAL_MS = 30_000;

export function IntegrationHealthPanel({
  compact = false,
  autoRefresh = true,
}: {
  compact?: boolean;
  autoRefresh?: boolean;
}) {
  const [data, setData] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/health", { cache: "no-store" });
      const json = (await res.json()) as HealthResponse;
      if (!mounted.current) return;
      setData(json);
      setUpdatedAt(new Date().toLocaleTimeString("ko-KR"));
      if (!res.ok && json.error) setError(json.error);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : "통합 상태를 불러오지 못했습니다.");
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    if (!autoRefresh) return () => { mounted.current = false; };
    const timer = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [load, autoRefresh]);

  const targets = data?.targets ?? [];
  const overallStatus: IntegrationStatus =
    data?.overall === "ok" ? "healthy" : data?.overall === "degraded" ? "degraded" : "unknown";

  return (
    <Card aria-busy={refreshing}>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <ServerCog className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            MCP 서비스 통합 상태
          </CardTitle>
          <CardDescription>
            services/* 컨테이너 헬스 프로브 (HTTP)
            {updatedAt ? ` · ${updatedAt} 갱신` : ""}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!loading && data && <StatusPill status={overallStatus} />}
          <Button
            variant="outline"
            size="icon-sm"
            onClick={load}
            disabled={refreshing}
            aria-label="통합 상태 새로고침"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden="true" />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Screen-reader live announcement of overall state */}
        <p className="sr-only" aria-live="polite">
          {loading
            ? "통합 상태를 불러오는 중입니다."
            : `전체 상태 ${STATUS_META[overallStatus].label}. 정상 ${data?.summary?.healthy ?? 0}개, 총 ${data?.summary?.total ?? 0}개.`}
        </p>

        {loading && (
          <div className="space-y-2">
            {Array.from({ length: compact ? 2 : 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        )}

        {!loading && error && (
          <div
            role="alert"
            className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300"
          >
            <p className="font-bold">통합 상태 조회 실패</p>
            <p className="mt-0.5 leading-relaxed">{error}</p>
            <Button variant="outline" size="xs" onClick={load} className="mt-2">
              다시 시도
            </Button>
          </div>
        )}

        {!loading && !error && targets.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            등록된 통합 대상이 없습니다.
          </p>
        )}

        {!loading && targets.length > 0 && (
          <ul className="divide-y divide-border rounded-md border border-border" aria-label="통합 대상 목록">
            {targets.map((t) => {
              const status = normalizeStatus(t.status);
              const meta = STATUS_META[status];
              return (
                <li key={t.id} className="flex items-center gap-3 p-3">
                  <span
                    className={cn("h-2 w-2 shrink-0 rounded-full", meta.dot)}
                    role="img"
                    aria-label={meta.label}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold">
                        {TARGET_LABELS[t.id] ?? t.id}
                      </p>
                      {typeof t.latencyMs === "number" && status !== "unreachable" && (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {t.latencyMs}ms
                        </span>
                      )}
                    </div>
                    {!compact && (
                      <p className="truncate font-mono text-xs text-muted-foreground" title={t.upstream}>
                        {t.upstream || t.readinessNote || "—"}
                      </p>
                    )}
                  </div>
                  <StatusPill status={status} className="shrink-0" />
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
