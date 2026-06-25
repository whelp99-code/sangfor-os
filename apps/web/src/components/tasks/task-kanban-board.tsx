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

const COLUMNS = ["todo", "doing", "waiting", "done"] as const;

const NEXT: Record<string, string> = {
  todo: "doing",
  doing: "waiting",
  waiting: "done",
};

export function TaskKanbanBoard({ tasks }: { tasks: Task[] }) {
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
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {COLUMNS.map((col) => {
        const columnTasks = tasks.filter((t) => t.status === col);
        return (
          <div key={col} className="rounded-md border p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {col} ({columnTasks.length})
            </p>
            <div className="space-y-2">
              {columnTasks.map((task) => (
                <div key={task.id} className="rounded-md border bg-background p-2 text-sm">
                  <p className="font-medium">{task.title}</p>
                  <p className="text-muted-foreground">
                    {task.customer?.name ?? task.partner?.name ?? "Unlinked"}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge variant="outline">{task.priority}</Badge>
                    {NEXT[task.status] ? (
                      <Button size="sm" variant="secondary" onClick={() => advance(task.id, task.status)}>
                        Advance
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

