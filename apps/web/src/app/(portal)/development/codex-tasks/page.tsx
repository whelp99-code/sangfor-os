export const dynamic = "force-dynamic";

import { listCodexTasks } from "@sangfor/business";
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
          <h1 className="text-2xl font-semibold tracking-tight">Codex 작업</h1>
          <p className="text-muted-foreground">커맨드 실행에 연결된 Codex 에이전트 작업 추적.</p>
        </div>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/development">
          개발 센터로 돌아가기
        </Link>
      </div>
      <div className="grid gap-3">
        {tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">아직 Codex 작업이 없습니다.</p>
        ) : (
          tasks.map((task) => (
            <Card key={task.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{task.title}</CardTitle>
                <Badge variant="outline">{task.status}</Badge>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                실행: {task.commandRunId ?? "—"} · 로그: {task.logs.length}건
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
