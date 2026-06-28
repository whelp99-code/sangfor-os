"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Plus, Trash2, Zap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { Playbook, Schedule } from "@/lib/agent/types";

type ScheduleWithName = Schedule & { playbookName: string };

export function SchedulesPanel() {
  const [schedules, setSchedules] = useState<ScheduleWithName[]>([]);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [playbookId, setPlaybookId] = useState("");
  const [interval, setIntervalMinutes] = useState(60);
  const [ticking, setTicking] = useState(false);
  const [tickMsg, setTickMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, p] = await Promise.all([
      fetch("/api/agent/schedules", { cache: "no-store" }).then((r) => r.json()),
      fetch("/api/agent/playbooks", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setSchedules(s.schedules ?? []);
    setPlaybooks(p.playbooks ?? []);
    if (!playbookId && p.playbooks?.[0]) setPlaybookId(p.playbooks[0].id);
  }, [playbookId]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (!playbookId || !(interval > 0)) return;
    await fetch("/api/agent/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playbookId, intervalMinutes: interval }),
    });
    await load();
  }

  async function toggle(s: ScheduleWithName) {
    await fetch(`/api/agent/schedules/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !s.enabled }),
    });
    await load();
  }

  async function remove(id: string) {
    await fetch(`/api/agent/schedules/${id}`, { method: "DELETE" });
    await load();
  }

  async function tick() {
    setTicking(true);
    setTickMsg(null);
    try {
      const res = await fetch("/api/agent/schedules/tick", { method: "POST" });
      const json = await res.json();
      setTickMsg(`${json.count}개 스케줄 실행됨`);
      await load();
    } finally {
      setTicking(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">스케줄</CardTitle>
            <CardDescription>
              플레이북을 주기적으로 실행합니다. 도래한 스케줄은 외부 cron이 <code className="font-mono">POST /api/agent/schedules/tick</code> 를
              호출하거나 아래 버튼으로 실행합니다.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {tickMsg && <span className="text-xs text-muted-foreground">{tickMsg}</span>}
            <Button size="sm" variant="outline" onClick={tick} disabled={ticking}>
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              지금 도래분 실행
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {schedules.length === 0 ? (
            <p className="p-6 text-center text-xs text-muted-foreground">등록된 스케줄이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-border" aria-label="스케줄 목록">
              {schedules.map((s) => (
                <li key={s.id} className="flex items-center gap-3 p-3">
                  <CalendarClock className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{s.playbookName}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {s.intervalMinutes}분 주기 · 다음 {new Date(s.nextRunAt).toLocaleString("ko-KR")}
                      {s.lastRunAt ? ` · 최근 ${new Date(s.lastRunAt).toLocaleTimeString("ko-KR")}` : ""}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      s.enabled
                        ? "border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-300"
                        : "border-border bg-muted text-[10px] text-muted-foreground"
                    }
                  >
                    {s.enabled ? "활성" : "비활성"}
                  </Badge>
                  <Button size="xs" variant="outline" onClick={() => toggle(s)}>
                    {s.enabled ? "중지" : "시작"}
                  </Button>
                  <Button size="icon-xs" variant="ghost" onClick={() => remove(s.id)} aria-label="스케줄 삭제">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">새 스케줄</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs">
            플레이북
            <select
              value={playbookId}
              onChange={(e) => setPlaybookId(e.target.value)}
              className="rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            >
              {playbooks.length === 0 && <option value="">(플레이북 없음)</option>}
              {playbooks.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            주기(분)
            <input
              type="number"
              min={1}
              value={interval}
              onChange={(e) => setIntervalMinutes(Math.max(1, Number(e.target.value) || 60))}
              className="w-24 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
            />
          </label>
          <Button size="sm" onClick={create} disabled={!playbookId}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            추가
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
