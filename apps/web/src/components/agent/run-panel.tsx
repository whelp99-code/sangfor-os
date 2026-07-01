"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Play, RefreshCw, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAgentRun } from "@/lib/agent/use-agent-run";
import type { AgentRunRecord } from "@/lib/agent/types";

import { StepTimeline } from "./step-timeline";

const PHASE_BADGE: Record<string, { label: string; cls: string }> = {
  idle: { label: "대기", cls: "bg-muted text-muted-foreground border-border" },
  running: { label: "실행 중", cls: "bg-primary/10 text-primary border-primary/20" },
  completed: { label: "완료", cls: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" },
  blocked: { label: "승인 필요", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" },
  max_steps: { label: "스텝 한도", cls: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" },
  error: { label: "오류", cls: "bg-red-500/10 text-red-700 dark:text-red-300 border-red-500/20" },
};

export function RunPanel({ initialGoal }: { initialGoal?: string }) {
  const { phase, steps, answer, blocked, error, run } = useAgentRun();
  const [goal, setGoal] = useState(initialGoal ?? "");
  const [maxSteps, setMaxSteps] = useState(6);
  const [allowUnsafe, setAllowUnsafe] = useState(false);
  const [history, setHistory] = useState<AgentRunRecord[]>([]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/runs?limit=20", { cache: "no-store" });
      const json = await res.json();
      setHistory(json.runs ?? []);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Refresh history when a run reaches a terminal phase.
  useEffect(() => {
    if (phase !== "idle" && phase !== "running") loadHistory();
  }, [phase, loadHistory]);

  const running = phase === "running";
  const badge = PHASE_BADGE[phase] ?? PHASE_BADGE.idle;

  function start(unsafe = allowUnsafe) {
    if (!goal.trim() || running) return;
    run({ goal: goal.trim(), maxSteps, allowUnsafe: unsafe, source: "manual" });
  }

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
      {/* Console */}
      <div className="space-y-4 lg:col-span-8">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">에이전트 실행</CardTitle>
            <CardDescription>
              목표를 입력하면 에이전트가 MCP 도구를 선택·연쇄 호출해 달성합니다. 안전 도구만 자동
              실행되고, 그 외 도구는 승인이 필요합니다.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="agent-goal" className="text-xs font-semibold">
                목표
              </label>
              <textarea
                id="agent-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={3}
                placeholder="예: NGAF 방화벽 정책 매뉴얼을 검색해 핵심 설정 단계를 요약해줘"
                className="w-full rounded-md border border-input bg-background p-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-1.5 text-xs">
                최대 스텝
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(Math.max(1, Math.min(20, Number(e.target.value) || 6)))}
                  className="w-16 rounded-md border border-input bg-background px-2 py-1 text-xs"
                />
              </label>
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={allowUnsafe}
                  onChange={(e) => setAllowUnsafe(e.target.checked)}
                  className="accent-primary"
                />
                안전하지 않은 도구 허용 (주의)
              </label>
              <div className="ml-auto flex items-center gap-2">
                <Badge className={cn("border", badge.cls)} variant="outline">
                  {badge.label}
                </Badge>
                <Button onClick={() => start()} disabled={running || !goal.trim()} size="sm">
                  {running ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  실행
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Blocked → approval */}
        {phase === "blocked" && blocked && (
          <div
            role="alert"
            className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-200"
          >
            <div className="flex items-center gap-2 text-sm font-bold">
              <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
              승인 필요: 안전하지 않은 도구
            </div>
            <p className="text-xs leading-relaxed">
              에이전트가 화이트리스트에 없는 도구 <code className="font-mono">{blocked.tool}</code> 를
              호출하려고 멈췄습니다. 승인하면 같은 목표를 안전하지 않은 도구 허용 상태로 다시
              실행합니다.
            </p>
            <Button
              size="xs"
              variant="outline"
              className="border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-200"
              onClick={() => start(true)}
            >
              승인하고 재실행
            </Button>
          </div>
        )}

        {/* Final answer */}
        {phase === "completed" && answer && (
          <Card className="border-emerald-500/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                최종 답변
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {phase === "error" && error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-300">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-bold">실행 실패</p>
              <p className="mt-0.5 leading-relaxed">{error}</p>
              <p className="mt-1 text-[11px] opacity-80">
                MCP 브릿지(:3600)와 LLM(OPENAI_*) 설정이 가동 중인지 확인하세요.
              </p>
            </div>
          </div>
        )}

        {/* Live timeline */}
        <div aria-live="polite">
          {steps.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">실행 추적 ({steps.length}단계)</CardTitle>
              </CardHeader>
              <CardContent>
                <StepTimeline steps={steps} />
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* History */}
      <div className="lg:col-span-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">실행 이력</CardTitle>
            <Button variant="outline" size="icon-sm" onClick={loadHistory} aria-label="이력 새로고침">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {history.length === 0 ? (
              <div className="space-y-1 p-6 text-center">
                <p className="text-xs font-semibold text-muted-foreground">실행 이력이 없습니다.</p>
                <p className="text-[11px] text-muted-foreground/80">
                  위에서 목표를 입력하고 “실행”하면 이력이 여기에 쌓입니다.
                </p>
              </div>
            ) : (
              <ul className="max-h-[520px] divide-y divide-border overflow-y-auto" aria-label="실행 이력 목록">
                {history.map((r) => {
                  const b = PHASE_BADGE[r.status] ?? PHASE_BADGE.idle;
                  return (
                    <li key={r.id} className="flex items-start gap-2 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium" title={r.goal}>
                          {r.goal}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {r.source} · {r.steps.length}단계 · {new Date(r.createdAt).toLocaleTimeString("ko-KR")}
                        </p>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0 border text-[10px]", b.cls)}>
                        {b.label}
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
