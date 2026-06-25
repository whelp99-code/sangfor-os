export const dynamic = "force-dynamic";

import Link from "next/link";
import { listCustomers, listGeneratedDocuments, listPocProjects } from "@ai-portal/automation";

import { GenerateProposalForm } from "@/components/proposals/generate-proposal-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default async function ProposalsPage() {
  const [documents, customers, pocProjects] = await Promise.all([
    listGeneratedDocuments(),
    listCustomers(),
    listPocProjects(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">제안서 관리</h1>
        <p className="text-muted-foreground">Multi-template documents with customer/PoC context and version history.</p>
      </div>
      <GenerateProposalForm
        customers={customers.map((c) => ({ id: c.id, label: c.name }))}
        pocProjects={pocProjects.map((p) => ({ id: p.id, label: p.title }))}
      />
      <div className="grid gap-3">
        {documents.length === 0 ? (
          <div className="text-center p-8 border border-dashed rounded-md bg-muted/10">
            <p className="text-sm font-semibold text-muted-foreground">No proposals generated yet</p>
            <p className="text-xs text-muted-foreground/80 mt-1">Select a customer or PoC and run the PM skill generator to draft a PRD.</p>
          </div>
        ) : (
          documents.map((doc) => (
            <Card key={doc.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  <Link href={`/proposals/${doc.id}`} className="hover:underline">{doc.title}</Link>
                </CardTitle>
                <div className="flex gap-2">
                  <Badge variant="secondary">{doc.template?.templateKey ?? "template"}</Badge>
                  <Badge variant="outline">{doc.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
                {doc.bodyMarkdown.slice(0, 400)}
                {doc.pocProject ? (
                  <p className="mt-2 text-xs">PoC: {doc.pocProject.title}</p>
                ) : null}
                {doc.customer ? (
                  <p className="mt-1 text-xs">Customer: {doc.customer.name}</p>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
