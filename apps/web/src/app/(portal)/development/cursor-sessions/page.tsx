export const dynamic = "force-dynamic";

import { listCursorSessions } from "@ai-portal/automation";
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
          <h1 className="text-2xl font-semibold tracking-tight">Cursor Sessions</h1>
          <p className="text-muted-foreground">Local IDE sessions with branch and build/test tracking.</p>
        </div>
        <Link className={buttonVariants({ variant: "outline", size: "sm" })} href="/development">
          Back to Development
        </Link>
      </div>
      <div className="grid gap-3">
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Cursor sessions recorded yet.</p>
        ) : (
          sessions.map((session) => (
            <Card key={session.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">{session.taskSummary}</CardTitle>
                <Badge variant="outline">{session.status}</Badge>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Branch: {session.branchName} · build: {session.buildStatus ?? "—"} · test:{" "}
                {session.testStatus ?? "—"}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
