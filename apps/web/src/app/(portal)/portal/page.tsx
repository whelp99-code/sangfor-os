export const dynamic = "force-dynamic";

import { listPortalTasks } from "@ai-portal/automation";

import { PortalActions } from "@/components/portal/portal-actions";
import { getPortalMailOverview, listPortalMailMessages } from "@/lib/mail-adapter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function PortalMvpPage() {
  const [mailOverview, tasks, messages] = await Promise.all([
    getPortalMailOverview(),
    listPortalTasks(),
    listPortalMailMessages(10),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">AI Work Portal MVP</h1>
        <p className="text-muted-foreground">
          Mail intelligence adapter (read-only). Task candidates bridge to work_tasks — no send/delete/move in portal body.
        </p>
      </div>
      <PortalActions />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Mail accounts</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{mailOverview.accounts}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Messages</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{mailOverview.messages}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Portal tasks</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{tasks.length}</CardContent>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Recent mail</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {messages.length === 0 ? (
              <p className="text-muted-foreground">Connect Outlook mock to sync sample mail.</p>
            ) : (
              messages.map((mail) => (
                <div key={mail.id} className="flex justify-between gap-2">
                  <span>{mail.subject}</span>
                  <Badge variant="outline">{mail.groupKey ?? "general"}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Task candidates</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {mailOverview.taskCandidates.length === 0 ? (
              <p className="text-muted-foreground">No active task candidates flagged from mail accounts.</p>
            ) : (
              mailOverview.taskCandidates.map((c) => (
                <div key={c.mailMessageId} className="rounded-md border p-2">
                  <p className="font-medium">{c.title}</p>
                  <p className="text-muted-foreground">{c.summary}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
