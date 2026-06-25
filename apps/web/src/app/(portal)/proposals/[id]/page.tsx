import { getGeneratedDocumentDetail } from "@ai-portal/automation";
import { buildProposalOrchestratorSummary } from "@ai-portal/automation/skills";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PortalOrchestratorRunPanel } from "@/components/phase13/portal-orchestrator-run-panel";
import { SaveProposalForm } from "@/components/proposals/save-proposal-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type PageProps = { params: Promise<{ id: string }> };

export default async function ProposalDetailPage({ params }: PageProps) {
  const { id } = await params;
  const document = await getGeneratedDocumentDetail(id);
  if (!document) notFound();

  return (
    <div className="space-y-6">
      <div>
        <Link href="/proposals" className="text-sm text-muted-foreground hover:underline">
          ← Back to proposals
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{document.title}</h1>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge variant="secondary">{document.template?.templateKey ?? "template"}</Badge>
          <Badge variant="outline">{document.status}</Badge>
          {document.customer ? <Badge variant="outline">Customer: {document.customer.name}</Badge> : null}
          {document.pocProject ? <Badge variant="outline">PoC: {document.pocProject.title}</Badge> : null}
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
      <Card>
        <CardHeader><CardTitle>Edit document</CardTitle></CardHeader>
        <CardContent>
          <SaveProposalForm documentId={document.id} initialBody={document.bodyMarkdown} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Version history ({document.versions.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          {document.versions.map((v) => (
            <div key={v.id} className="rounded-md border p-3">
              <p className="mb-2 font-medium">Version {v.version}</p>
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
