"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Play,
  RefreshCw,
  Search,
  Terminal,
  Wrench,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type McpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

type CallState = {
  loading: boolean;
  ok: boolean | null;
  payload: unknown;
  error: string | null;
  allowedTools?: string[];
};

const IDLE_CALL: CallState = { loading: false, ok: null, payload: null, error: null };

export function McpToolsClient() {
  const [tools, setTools] = useState<McpTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [argsText, setArgsText] = useState("{}");
  const [argsError, setArgsError] = useState<string | null>(null);
  const [call, setCall] = useState<CallState>(IDLE_CALL);
  const mounted = useRef(true);

  const loadTools = useCallback(async () => {
    setRefreshing(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/mcp/tools", { cache: "no-store" });
      const json = (await res.json()) as { tools?: McpTool[]; error?: string };
      if (!mounted.current) return;
      setTools(json.tools ?? []);
      if (!res.ok || json.error) setLoadError(json.error ?? `HTTP ${res.status}`);
    } catch (e) {
      if (!mounted.current) return;
      setLoadError(e instanceof Error ? e.message : "MCP 브릿지에 연결할 수 없습니다.");
    } finally {
      if (mounted.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    loadTools();
    return () => {
      mounted.current = false;
    };
  }, [loadTools]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q),
    );
  }, [tools, query]);

  const activeTool = useMemo(
    () => tools.find((t) => t.name === selected) ?? null,
    [tools, selected],
  );

  function selectTool(name: string) {
    setSelected(name);
    setCall(IDLE_CALL);
    setArgsError(null);
    setArgsText("{}");
  }

  async function runTool() {
    if (!activeTool) return;
    let parsedArgs: Record<string, unknown> = {};
    if (argsText.trim()) {
      try {
        parsedArgs = JSON.parse(argsText);
      } catch {
        setArgsError("올바른 JSON 형식이 아닙니다.");
        return;
      }
    }
    setArgsError(null);
    setCall({ ...IDLE_CALL, loading: true });
    try {
      const res = await fetch("/api/mcp/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: activeTool.name, arguments: parsedArgs }),
      });
      const json = (await res.json()) as {
        result?: unknown;
        error?: string;
        allowedTools?: string[];
      };
      if (!mounted.current) return;
      if (res.ok && !json.error) {
        setCall({ loading: false, ok: true, payload: json.result, error: null });
      } else {
        setCall({
          loading: false,
          ok: false,
          payload: null,
          error: json.error ?? `호출 실패 (HTTP ${res.status})`,
          allowedTools: json.allowedTools,
        });
      }
    } catch (e) {
      if (!mounted.current) return;
      setCall({
        loading: false,
        ok: false,
        payload: null,
        error: e instanceof Error ? e.message : "네트워크 오류",
      });
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tools</h1>
          <p className="text-muted-foreground">
            MCP 브릿지가 노출하는 도구 레지스트리 · 안전 도구는 읽기 전용으로 즉시 실행 가능
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={loadTools} disabled={refreshing}>
          <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden="true" />
          새로고침
        </Button>
      </div>

      {/* Stat widgets */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="등록된 도구" value={loading ? "…" : String(tools.length)} icon={<Wrench className="h-5 w-5" />} />
        <StatCard
          label="브릿지 연결"
          value={loading ? "…" : loadError ? "연결불가" : "정상"}
          icon={<Terminal className="h-5 w-5" />}
          tone={loadError ? "error" : "ok"}
        />
        <StatCard
          label="선택된 도구"
          value={activeTool ? activeTool.name.replace(/^sangfor\./, "") : "—"}
          icon={<Play className="h-5 w-5" />}
        />
      </div>

      {loadError && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-bold">MCP 브릿지 연결 실패</p>
            <p className="mt-0.5 leading-relaxed">{loadError}</p>
            <p className="mt-1 text-[11px] text-red-600/80 dark:text-red-400/80">
              docker compose의 sangfor-engineer-mcp 브릿지(:3600)가 실행 중인지 확인하세요.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
        {/* Tool list */}
        <div className="lg:col-span-5">
          <Card className="flex flex-col">
            <div className="border-b border-border p-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="도구 검색…"
                  aria-label="도구 검색"
                  className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
            </div>
            <CardContent className="max-h-[520px] overflow-y-auto p-0">
              {loading ? (
                <div className="space-y-2 p-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <div className="space-y-1 p-10 text-center">
                  <Wrench className="mx-auto h-7 w-7 text-muted-foreground/30" aria-hidden="true" />
                  <p className="text-xs font-semibold text-muted-foreground">
                    {tools.length === 0 ? "노출된 도구가 없습니다" : "검색 결과가 없습니다"}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border" aria-label="MCP 도구 목록">
                  {filtered.map((t) => {
                    const isSelected = t.name === selected;
                    return (
                      <li key={t.name}>
                        <button
                          type="button"
                          onClick={() => selectTool(t.name)}
                          aria-current={isSelected}
                          className={cn(
                            "relative flex w-full flex-col gap-0.5 p-3 text-left transition-colors hover:bg-muted/40",
                            isSelected && "bg-muted/60",
                          )}
                        >
                          {isSelected && (
                            <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r bg-primary" aria-hidden="true" />
                          )}
                          <code className="font-mono text-sm font-semibold text-foreground">{t.name}</code>
                          {t.description && (
                            <span className="line-clamp-2 text-xs text-muted-foreground">{t.description}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Tool detail + invoke */}
        <div className="lg:col-span-7">
          {!activeTool ? (
            <Card className="flex flex-col items-center justify-center p-12 text-center">
              <Play className="mb-3 h-10 w-10 text-muted-foreground/20" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-muted-foreground">도구를 선택하세요</h2>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground/80">
                왼쪽 목록에서 도구를 선택하면 입력 스키마를 확인하고 직접 호출할 수 있습니다.
              </p>
            </Card>
          ) : (
            <Card>
              <CardContent className="space-y-4 p-4">
                <div className="space-y-1">
                  <code className="font-mono text-base font-bold">{activeTool.name}</code>
                  {activeTool.description && (
                    <p className="text-sm text-muted-foreground">{activeTool.description}</p>
                  )}
                </div>

                {activeTool.inputSchema != null && (
                  <details className="rounded-md border border-border bg-muted/20">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-muted-foreground">
                      입력 스키마 (inputSchema)
                    </summary>
                    <pre className="max-h-48 overflow-auto border-t border-border p-3 font-mono text-xs leading-relaxed">
                      {JSON.stringify(activeTool.inputSchema, null, 2)}
                    </pre>
                  </details>
                )}

                {/* Arguments editor */}
                <div className="space-y-1.5">
                  <label htmlFor="mcp-args" className="text-xs font-semibold">
                    인자 (JSON)
                  </label>
                  <textarea
                    id="mcp-args"
                    value={argsText}
                    onChange={(e) => setArgsText(e.target.value)}
                    spellCheck={false}
                    rows={4}
                    aria-invalid={Boolean(argsError)}
                    aria-describedby={argsError ? "mcp-args-error" : undefined}
                    className="w-full rounded-md border border-input bg-background p-2.5 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive"
                  />
                  {argsError && (
                    <p id="mcp-args-error" role="alert" className="text-xs text-destructive">
                      {argsError}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Button onClick={runTool} disabled={call.loading} size="sm">
                    {call.loading ? (
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    도구 실행
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    실행은 브릿지의 안전 도구 화이트리스트를 통과해야 합니다.
                  </span>
                </div>

                {/* Result region */}
                <div aria-live="polite">
                  {call.ok === true && (
                    <div className="space-y-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 p-3">
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                        실행 성공
                      </div>
                      <pre className="max-h-72 overflow-auto rounded-sm bg-zinc-950 p-2.5 font-mono text-xs leading-relaxed text-emerald-300">
                        {JSON.stringify(call.payload, null, 2)}
                      </pre>
                    </div>
                  )}
                  {call.ok === false && (
                    <div className="space-y-1.5 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-red-700 dark:text-red-300">
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                        실행 실패
                      </div>
                      <p className="text-xs leading-relaxed">{call.error}</p>
                      {call.allowedTools && call.allowedTools.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 pt-1">
                          <span className="text-[11px] font-semibold">허용된 도구:</span>
                          {call.allowedTools.map((name) => (
                            <Badge key={name} variant="outline" className="font-mono text-[10px]">
                              {name}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: "default" | "ok" | "error";
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p
            className={cn(
              "truncate text-xl font-bold",
              tone === "ok" && "text-emerald-600 dark:text-emerald-400",
              tone === "error" && "text-red-600 dark:text-red-400",
            )}
          >
            {value}
          </p>
        </div>
        <div className="shrink-0 rounded-md border border-border bg-muted p-2.5 text-muted-foreground">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}
