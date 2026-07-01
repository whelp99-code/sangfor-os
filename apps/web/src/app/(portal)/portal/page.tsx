export const dynamic = "force-dynamic";

import { listPortalTasks } from "@sangfor/business";

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
        <h1 className="text-2xl font-semibold tracking-tight">AI 워크 포털 MVP</h1>
        <p className="text-muted-foreground">
          Mail Intelligence 어댑터(읽기 전용)입니다. 작업 후보는 work_tasks로 연결되며, 포털 본문에서는 전송·삭제·이동을 지원하지 않습니다.
        </p>
      </div>
      <PortalActions />
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">메일 계정</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{mailOverview.accounts}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">메시지</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{mailOverview.messages}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">포털 작업</CardTitle></CardHeader>
          <CardContent className="text-2xl font-semibold">{tasks.length}</CardContent>
        </Card>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>최근 메일</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {messages.length === 0 ? (
              <p className="text-muted-foreground">Outlook 목(mock)을 연결하면 샘플 메일이 동기화됩니다.</p>
            ) : (
              messages.map((mail) => (
                <div key={mail.id} className="flex justify-between gap-2">
                  <span>{mail.subject}</span>
                  <Badge variant="outline">{mail.groupKey ?? "일반"}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>작업 후보</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {mailOverview.taskCandidates.length === 0 ? (
              <p className="text-muted-foreground">메일 계정에서 감지된 활성 작업 후보가 없습니다.</p>
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
