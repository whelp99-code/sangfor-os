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
        <CardTitle>Mail evidence</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {evidence.length === 0 ? (
          <p className="text-muted-foreground">No mail evidence linked yet.</p>
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
                <EvidenceList title="Evidence" items={item.candidate.evidenceItems} />
                <EvidenceList title="Next actions" items={item.candidate.nextActions} />
                <EvidenceList title="AI evidence" items={item.candidate.aiEvidence} />
              </div>
              <p className="text-xs text-muted-foreground">
                Source: {item.candidate.sourceTitle ?? "mail"} · Sender: {item.candidate.sourceSender ?? "unknown"}
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
        <p className="text-xs text-muted-foreground">None</p>
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
