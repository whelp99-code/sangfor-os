import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type MailEvidenceItem = {
  linkId: string;
  linkType: string;
  candidate: {
    id: string;
    candidateType: string;
    title: string;
    summary: string;
    sourceTitle: string | null;
    sourceSender: string | null;
    status: string;
    evidenceItems: string[];
    nextActions: string[];
    aiEvidence: string[];
  };
};

type Props = {
  evidence: MailEvidenceItem[];
};

export function MailEvidenceCard({ evidence }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>메일 근거</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {evidence.length === 0 ? (
          <p className="text-muted-foreground">아직 연결된 메일 근거가 없습니다.</p>
        ) : (
          evidence.map((item) => (
            <div key={item.linkId} className="space-y-2 rounded-md border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{item.linkType}</Badge>
                <Badge variant="secondary">{item.candidate.candidateType}</Badge>
                <Badge variant="outline">{item.candidate.status}</Badge>
                <Link
                  href={`/approvals/mail-candidates/${item.candidate.id}`}
                  className="font-medium hover:underline"
                >
                  {item.candidate.title}
                </Link>
              </div>
              <p className="break-words text-muted-foreground">{item.candidate.summary}</p>
              <div className="grid gap-2 md:grid-cols-3">
                <EvidenceList title="근거" items={item.candidate.evidenceItems} />
                <EvidenceList title="다음 조치" items={item.candidate.nextActions} />
                <EvidenceList title="AI 근거" items={item.candidate.aiEvidence} />
              </div>
              <p className="text-xs text-muted-foreground">
                출처: {item.candidate.sourceTitle ?? "메일"} · 발신자: {item.candidate.sourceSender ?? "알 수 없음"}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function EvidenceList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md bg-muted/30 p-2">
      <p className="mb-1 text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">없음</p>
      ) : (
        <ul className="space-y-1 text-xs">
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="break-words">{item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
