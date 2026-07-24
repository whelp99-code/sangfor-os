export const dynamic = "force-dynamic";

import {
  listEngagements,
  listTodayTasks,
  listWorkTasks,
  resolveOpportunityAuthContext,
} from "@sangfor/business";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CreateTaskForm } from "@/components/tasks/create-task-form";
import { TaskBoard } from "@/components/tasks/task-board";
import { TaskKanbanBoard } from "@/components/tasks/task-kanban-board";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export default async function TasksPage() {
  const token = (await cookies()).get("session")?.value;
  if (!token) redirect("/login");
  const session = await evaluatePersistedSessionFromRequest(new Request(
    "http://sangfor.local/tasks",
    { headers: { cookie: `session=${encodeURIComponent(token)}` } },
  ));
  if (!session.ok) redirect("/login");
  const ctx = await resolveOpportunityAuthContext({
    userId: session.userId,
    sessionId: null,
    tenantId: session.tenantId,
    companyId: session.companyId,
    projectId: session.projectId,
    product: "portal",
  });
  const [all, today, engagements] = await Promise.all([
    listWorkTasks(),
    listTodayTasks(),
    listEngagements(ctx),
  ]);
  const engagementOptions = engagements.map((e) => ({ id: e.id, name: e.name }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">작업 관리</h1>
        <p className="text-muted-foreground">고객사와 파트너에 연결된 작업을 관리합니다.</p>
      </div>
      <CreateTaskForm engagements={engagementOptions} />
      <Card>
        <CardHeader><CardTitle>보드</CardTitle></CardHeader>
        <CardContent><TaskKanbanBoard tasks={all} /></CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>오늘 ({today.length})</CardTitle></CardHeader>
        <CardContent><TaskBoard tasks={today} /></CardContent>
      </Card>
    </div>
  );
}
