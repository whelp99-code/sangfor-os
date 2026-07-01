export const dynamic = "force-dynamic";

import { listCursorSessions } from "@sangfor/business";
import Link from "next/link";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

export default async function CursorSessionsPage() {
  const sessions = await listCursorSessions();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cursor 세션</h1>
          <p className="text-muted-foreground">브랜치·빌드·테스트 상태까지 추적하는 로컬 IDE 세션.</p>
        </div>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/development">
          개발 센터로 돌아가기
        </Link>
      </div>
      <div className="grid gap-3">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            아직 기록된 Cursor 세션이 없습니다. 로컬 IDE에서 Cursor 작업을 시작하면 여기에 표시됩니다.
          </p>
        ) : (
          sessions.map((session) => (
            <Card key={session.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{session.taskSummary}</CardTitle>
                <Badge variant="outline">{session.status}</Badge>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                브랜치: {session.branchName} · 빌드: {session.buildStatus ?? "—"} · 테스트:{" "}
                {session.testStatus ?? "—"}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
