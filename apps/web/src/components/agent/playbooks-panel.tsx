"use client";

import { useCallback, useEffect, useState } from "react";
import { BookMarked, Play, Plus, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAgentRun } from "@/lib/agent/use-agent-run";
import type { Playbook } from "@/lib/agent/types";

import { StepTimeline } from "./step-timeline";

export function PlaybooksPanel() {
  const { phase, steps, answer, error, goal: runningGoal, run } = useAgentRun();
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [allowUnsafe, setAllowUnsafe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/agent/playbooks", { cache: "no-store" });
    const json = await res.json();
    setPlaybooks(json.playbooks ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!name.trim() || !goal.trim() || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch("/api/agent/playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), goal: goal.trim(), allowUnsafe }),
      });
      if (!res.ok) {
        setFormError("플레이북 저장에 실패했습니다. 다시 시도해 주세요.");
        return;
      }
      setName("");
      setGoal("");
      setAllowUnsafe(false);
      await load();
    } catch {
      setFormError("플레이북 저장에 실패했습니다. 네트워크를 확인해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setFormError(null);
    try {
      const res = await fetch(`/api/agent/playbooks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setFormError("플레이북 삭제에 실패했습니다.");
        return;
      }
      await load();
    } catch {
      setFormError("플레이북 삭제에 실패했습니다. 네트워크를 확인해 주세요.");
    }
  }

  function runPlaybook(p: Playbook) {
    run({ goal: p.goal, allowUnsafe: p.allowUnsafe, maxSteps: p.maxSteps, source: "playbook", playbookId: p.id });
  }

  const running = phase === "running";

  return (
    <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
      <div className="space-y-4 lg:col-span-7">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">플레이북</CardTitle>
            <CardDescription>자주 쓰는 목표를 저장해 원클릭으로 실행합니다.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {playbooks.length === 0 ? (
              <div className="space-y-1 p-6 text-center">
                <p className="text-xs font-semibold text-muted-foreground">저장된 플레이북이 없습니다.</p>
                <p className="text-[11px] text-muted-foreground/80">
                  아래 “새 플레이북”에서 자주 쓰는 목표를 등록하면 원클릭으로 실행할 수 있습니다.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border" aria-label="플레이북 목록">
                {playbooks.map((p) => (
                  <li key={p.id} className="flex items-start gap-3 p-3">
                    <BookMarked className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{p.name}</p>
                        {p.allowUnsafe && (
                          <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">
                            unsafe
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground" title={p.goal}>
                        {p.goal}
                      </p>
                    </div>
                    <Button size="xs" onClick={() => runPlaybook(p)} disabled={running}>
                      <Play className="h-3 w-3" aria-hidden="true" />
                      실행
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => remove(p.id)}
                      aria-label={`${p.name} 삭제`}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Create */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">새 플레이북</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="이름 (예: NGAF 매뉴얼 검색)"
              aria-label="플레이북 이름"
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              placeholder="목표"
              aria-label="플레이북 목표"
              className="w-full rounded-md border border-input bg-background p-2.5 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={allowUnsafe}
                  onChange={(e) => setAllowUnsafe(e.target.checked)}
                  className="accent-primary"
                />
                안전하지 않은 도구 허용
              </label>
              <Button size="sm" onClick={create} disabled={saving || !name.trim() || !goal.trim()}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                저장
              </Button>
            </div>
            {formError && (
              <p className="text-xs text-red-600 dark:text-red-400" role="alert">
                {formError}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Inline run result */}
      <div className="lg:col-span-5" aria-live="polite">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">실행 결과</CardTitle>
            {running && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />}
          </CardHeader>
          <CardContent className="space-y-3">
            {phase === "idle" ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                플레이북의 “실행”을 누르면 여기에 추적이 표시됩니다.
              </p>
            ) : (
              <>
                {runningGoal && <p className="text-xs text-muted-foreground">목표: {runningGoal}</p>}
                {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
                {answer && <p className="whitespace-pre-wrap rounded-md bg-emerald-500/10 p-2.5 text-sm">{answer}</p>}
                <StepTimeline steps={steps} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
