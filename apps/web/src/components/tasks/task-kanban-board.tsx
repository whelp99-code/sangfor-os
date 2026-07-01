"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { formatDueAt, nextTaskStatus, taskStatusLabel, TASK_STATUSES } from "./task-meta";

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueAt?: string | Date | null;
  assigneeName?: string | null;
  customer?: { name: string } | null;
  partner?: { name: string } | null;
};

export function TaskKanbanBoard({ tasks }: { tasks: Task[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">작업이 없습니다.</p>;
  }

  async function advance(id: string, status: string) {
    const next = nextTaskStatus(status);
    if (!next) return;
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        setError("작업 상태를 변경하지 못했습니다. 잠시 후 다시 시도하세요.");
        return;
      }
      router.refresh();
    } catch {
      setError("작업 상태를 변경하지 못했습니다. 네트워크 연결을 확인하세요.");
    }
  }

  return (
    <div className="space-y-3">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {TASK_STATUSES.map((col) => {
        const columnTasks = tasks.filter((t) => t.status === col);
        return (
          <div key={col} className="rounded-md border p-3">
            <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground">
              {taskStatusLabel(col)} ({columnTasks.length})
            </p>
            <div className="space-y-2">
              {columnTasks.map((task) => {
                const due = formatDueAt(task.dueAt);
                return (
                  <div key={task.id} className="rounded-md border bg-background p-2 text-sm">
                    <p className="font-medium">{task.title}</p>
                    <p className="text-muted-foreground">
                      {task.assigneeName ? `${task.assigneeName} · ` : ""}
                      {task.customer?.name ?? task.partner?.name ?? "미연결"}
                      {due ? ` · 마감 ${due}` : ""}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge variant="outline">{task.priority}</Badge>
                      {nextTaskStatus(task.status) ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => advance(task.id, task.status)}
                        >
                          다음 단계
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
