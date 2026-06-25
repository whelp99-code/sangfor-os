"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Task = {
  id: string;
  title: string;
  status: string;
  priority: string;
  customer?: { name: string } | null;
  partner?: { name: string } | null;
};

const NEXT: Record<string, string> = {
  todo: "doing",
  doing: "done",
  waiting: "doing",
};

export function TaskBoard({ tasks }: { tasks: Task[] }) {
  if (tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No tasks.</p>;
  }

  async function advance(id: string, status: string) {
    const next = NEXT[status];
    if (!next) return;
    await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    window.location.reload();
  }

  return (
    <div className="space-y-2">
      {tasks.map((task) => (
        <div key={task.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm">
          <div>
            <p className="font-medium">{task.title}</p>
            <p className="text-muted-foreground">
              {task.customer?.name ?? task.partner?.name ?? "Unlinked"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{task.priority}</Badge>
            <Badge>{task.status}</Badge>
            {NEXT[task.status] ? (
              <Button size="sm" variant="secondary" onClick={() => advance(task.id, task.status)}>
                Advance
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
