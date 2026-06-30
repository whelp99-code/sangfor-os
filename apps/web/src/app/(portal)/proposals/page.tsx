export const dynamic = "force-dynamic";

import Link from "next/link";
import { listCustomers, listGeneratedDocuments, listPocProjects } from "@sangfor/business";

import { GenerateProposalForm } from "@/components/proposals/generate-proposal-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { proposalTemplateLabel } from "@/lib/proposal-template-labels";

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
        <p className="text-muted-foreground">
          고객사·PoC 맥락과 버전 이력을 갖춘 다중 템플릿 문서를 생성하고 관리합니다.
        </p>
      </div>
      <div id="generate-proposal" className="scroll-mt-20">
        <GenerateProposalForm
          customers={customers.map((c) => ({ id: c.id, label: c.name }))}
          pocProjects={pocProjects.map((p) => ({ id: p.id, label: p.title }))}
        />
      </div>
      <div className="grid gap-3">
        {documents.length === 0 ? (
          <div className="text-center p-8 border border-dashed rounded-md bg-muted/10">
            <p className="text-sm font-semibold text-muted-foreground">아직 생성된 제안서가 없습니다</p>
            <p className="text-xs text-muted-foreground/80 mt-1">
              고객사나 PoC를 선택하고 제안서 생성기를 실행해 첫 문서를 작성해 보세요.
            </p>
            <Link
              href="#generate-proposal"
              className="mt-4 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              새 제안서 생성
            </Link>
          </div>
        ) : (
          documents.map((doc) => (
            <Card key={doc.id}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  <Link href={`/proposals/${doc.id}`} className="hover:underline">{doc.title}</Link>
                </CardTitle>
                <div className="flex gap-2">
                  <Badge variant="secondary">
                    {doc.template?.templateKey ? proposalTemplateLabel(doc.template.templateKey) : "템플릿"}
                  </Badge>
                  <Badge variant="outline">{doc.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="whitespace-pre-wrap text-sm text-muted-foreground">
                {doc.bodyMarkdown.slice(0, 400)}
                {doc.pocProject ? (
                  <p className="mt-2 text-xs">PoC: {doc.pocProject.title}</p>
                ) : null}
                {doc.customer ? (
                  <p className="mt-1 text-xs">고객사: {doc.customer.name}</p>
                ) : null}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
