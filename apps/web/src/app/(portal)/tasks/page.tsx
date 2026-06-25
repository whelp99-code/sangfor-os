export const dynamic = "force-dynamic";

import { listTodayTasks, listWorkTasks } from "@ai-portal/automation";

import { CreateTaskForm } from "@/components/tasks/create-task-form";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskKanbanBoard } from "@/components/tasks/task-kanban-board";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function TasksPage() {
  const [all, today] = await Promise.all([listWorkTasks(), listTodayTasks()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">작업 관리</h1>
        <p className="text-muted-foreground">Manage work tasks linked to customers and partners.</p>
      </div>
      <CreateTaskForm />
      <Card>
        <CardHeader><CardTitle>Board</CardTitle></CardHeader>
        <CardContent><TaskKanbanBoard tasks={all} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Today ({today.length})</CardTitle></CardHeader>
        <CardContent><TaskBoard tasks={today} /></CardContent>
      </Card>
    </div>
  );
}
