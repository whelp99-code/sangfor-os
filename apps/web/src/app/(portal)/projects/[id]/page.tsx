import { getEngagementDetail } from "@sangfor/business";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type PageProps = { params: Promise<{ id: string }> };

export default async function ProjectDetailPage({ params }: PageProps) {
  const { id } = await params;
  const engagement = await getEngagementDetail(id);
  if (!engagement) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{engagement.name}</h1>
          <p className="text-muted-foreground">
            {engagement.opportunity?.customer?.name ?? "고객 미지정"}
            {engagement.amount != null ? ` · ${engagement.amount.toString()}` : ""}
            {engagement.convertedFromStage ? ` · 전환 단계 ${engagement.convertedFromStage}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <Badge>{engagement.status}</Badge>
          {engagement.opportunity && (
            <Link
              href={`/opportunities/${engagement.opportunityId}`}
              className="text-sm text-primary underline-offset-2 hover:underline"
            >
              ← 원 영업기회: {engagement.opportunity.title}
            </Link>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>제안서 ({engagement.generatedDocuments.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {engagement.generatedDocuments.length === 0 ? (
              <p className="text-muted-foreground">흡수된 제안서 없음</p>
            ) : (
              engagement.generatedDocuments.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2">
                  <Link href={`/proposals/${d.id}`} className="hover:underline">
                    {d.title}
                  </Link>
                  <Badge variant="secondary">{d.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>POC ({engagement.pocProjects.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {engagement.pocProjects.length === 0 ? (
              <p className="text-muted-foreground">흡수된 POC 없음</p>
            ) : (
              engagement.pocProjects.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2">
                  <Link href={`/poc/${p.id}`} className="hover:underline">
                    {p.title}
                  </Link>
                  <Badge variant="secondary">{p.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>미팅내용 ({engagement.meetingNotes.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {engagement.meetingNotes.length === 0 ? (
              <p className="text-muted-foreground">흡수된 미팅 없음</p>
            ) : (
              engagement.meetingNotes.map((m) => (
                <div key={m.id} className="space-y-1 rounded-lg border bg-background/60 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{m.title}</span>
                    <Badge variant={m.status === "suggested" ? "outline" : "secondary"}>
                      {m.source}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{m.bodyMarkdown}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>딜리버리 체크리스트 ({engagement.checklistItems.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {engagement.checklistItems.length === 0 ? (
              <p className="text-muted-foreground">체크리스트 없음</p>
            ) : (
              engagement.checklistItems.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span>{c.itemKey}</span>
                  <Badge variant="secondary">{c.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
