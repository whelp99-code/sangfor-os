export const dynamic = "force-dynamic";

import { listCodexTasks } from "@ai-portal/automation";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

export default async function CodexTasksPage() {
  const tasks = await listCodexTasks();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Codex Tasks</h1>
          <p className="text-muted-foreground">Tracked Codex agent work linked to command runs.</p>
        </div>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/development">
          Back to Development
        </Link>
      </div>
      <div className="grid gap-3">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Codex tasks yet.</p>
        ) : (
          tasks.map((task) => (
            <Card key={task.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{task.title}</CardTitle>
                <Badge variant="outline">{task.status}</Badge>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Run: {task.commandRunId ?? "—"} · Logs: {task.logs.length}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
