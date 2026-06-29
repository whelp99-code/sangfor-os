export const dynamic = "force-dynamic";

import Link from "next/link";
import { listEngagements } from "@sangfor/business";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ProjectsPage() {
  const engagements = await listEngagements();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">프로젝트</h1>
        <p className="text-muted-foreground">
          전환된 딜(Engagement)별 도메인 레인 · 딜 손익 · AI 제안 검토 허브.
        </p>
      </div>

      {engagements.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            아직 전환된 프로젝트가 없습니다. 영업기회에서 “프로젝트로 전환”을 누르면 여기에 표시됩니다.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {engagements.map((eng) => (
            <Link key={eng.id} href={`/projects/${eng.id}`} className="block">
              <Card className="transition-colors hover:border-primary">
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle className="text-base">{eng.name}</CardTitle>
                  <Badge variant="outline">{eng.status}</Badge>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>{eng.opportunity?.customer?.name ?? "고객 미연결"}</p>
                  <div className="flex gap-3 text-xs">
                    <span>제안서 {eng._count.generatedDocuments}</span>
                    <span>미팅 {eng._count.meetingNotes}</span>
                    <span>체크리스트 {eng._count.checklistItems}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
