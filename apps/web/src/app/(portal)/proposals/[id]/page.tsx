import { getGeneratedDocumentDetail, listMailEvidenceForEntity } from "@sangfor/business";
import { buildProposalOrchestratorSummary } from "@sangfor/business/skills";
import Link from "next/link";
import { notFound } from "next/navigation";

import { MailEvidenceCard } from "@/components/mail-candidates/mail-evidence-card";
import { PortalOrchestratorRunPanel } from "@/components/phase13/portal-orchestrator-run-panel";
import { SaveProposalForm } from "@/components/proposals/save-proposal-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildProposalActionGuards,
  proposalActionLabels,
} from "@/lib/proposal-action-guards";

type PageProps = { params: Promise<{ id: string }> };

export default async function ProposalDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [document, mailEvidence] = await Promise.all([
    getGeneratedDocumentDetail(id),
    listMailEvidenceForEntity("proposal", id),
  ]);
  if (!document) notFound();

  const actionGuards = buildProposalActionGuards(document.status);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/proposals" className="text-sm text-muted-foreground hover:underline">
          ← 제안서 목록으로
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{document.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="secondary">{document.template?.templateKey ?? "template"}</Badge>
          <Badge variant="outline">{document.status}</Badge>
          {document.customer ? <Badge variant="outline">Customer: {document.customer.name}</Badge> : null}
          {document.pocProject ? <Badge variant="outline">PoC: {document.pocProject.title}</Badge> : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
          {Object.entries(actionGuards).map(([action, guard]) => (
            <Badge key={action} variant={guard.allowed ? "secondary" : "outline"}>
              {proposalActionLabels[action as keyof typeof proposalActionLabels]}: {guard.allowed ? "allowed" : guard.reason}
            </Badge>
          ))}
        </div>
      </div>
      <PortalOrchestratorRunPanel
        title="Phase 13 orchestrator"
        buttonLabel="Generate PRD / Work Breakdown"
        inputSummary={buildProposalOrchestratorSummary(document)}
        sourceEntityType="proposal"
        sourceEntityId={document.id}
        module="proposal"
      />
      <MailEvidenceCard evidence={mailEvidence} />
      <Card>
        <CardHeader><CardTitle>문서 편집</CardTitle></CardHeader>
        <CardContent>
          <SaveProposalForm documentId={document.id} initialBody={document.bodyMarkdown} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>버전 이력 ({document.versions.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {document.versions.map((v) => (
            <div key={v.id} className="rounded-md border p-3">
              <p className="mb-2 font-medium">버전 {v.version}</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {v.bodyMarkdown.slice(0, 600)}
                {v.bodyMarkdown.length > 600 ? "…" : ""}
              </pre>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
