"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { formatDueAt, nextTaskStatus, taskStatusLabel } from "./task-meta";

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

export function TaskBoard({ tasks }: { tasks: Task[] }) {
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
    <div className="space-y-2">
      {error && (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}
      {tasks.map((task) => {
        const due = formatDueAt(task.dueAt);
        return (
          <div
            key={task.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
          >
            <div>
              <p className="font-medium">{task.title}</p>
              <p className="text-muted-foreground">
                {task.assigneeName ? `${task.assigneeName} · ` : ""}
                {task.customer?.name ?? task.partner?.name ?? "미연결"}
                {due ? ` · 마감 ${due}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{task.priority}</Badge>
              <Badge>{taskStatusLabel(task.status)}</Badge>
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
  );
}
