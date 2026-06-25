import { getPocDetail, listCustomers, listPartners } from "@ai-portal/automation";
import { buildPocOrchestratorSummary } from "@ai-portal/automation/skills";
import { notFound } from "next/navigation";

import { PortalOrchestratorRunPanel } from "@/components/phase13/portal-orchestrator-run-panel";
import { GeneratePocReportButton, PocEventForm, PocRequirementForm } from "@/components/poc/poc-detail-actions";
import { PocChecklistActions } from "@/components/poc/poc-checklist-actions";
import { EditPocForm } from "@/components/poc/edit-poc-form";
import { PocIssueForm, PocIssueRow } from "@/components/poc/poc-issue-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type PageProps = { params: Promise<{ id: string }> };

export default async function PocDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [project, customers, partners] = await Promise.all([
    getPocDetail(id),
    listCustomers(),
    listPartners(),
  ]);
  if (!project) notFound();

  const customerOptions = customers.map((c) => ({ id: c.id, label: c.name }));
  const partnerOptions = partners.map((p) => ({ id: p.id, label: p.name }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{project.title}</h1>
        <p className="text-muted-foreground">
          {project.productName ?? "Product TBD"}
          {project.productLine ? ` · ${project.productLine}` : ""}
          {" · "}
          {project.deploymentType ?? "deployment TBD"}
          {" · "}
          {project.customer?.name ?? "No customer"}
          {project.scheduleAt
            ? ` · Schedule ${project.scheduleAt.toISOString().slice(0, 10)}`
            : ""}
        </p>
      </div>
      <PortalOrchestratorRunPanel
        title="Phase 13 orchestrator"
        buttonLabel="Design assumptions / experiments"
        inputSummary={buildPocOrchestratorSummary(project)}
        sourceEntityType="poc"
        sourceEntityId={project.id}
        module="poc"
      />
      <Card>
        <CardHeader><CardTitle>Sangfor project details</CardTitle></CardHeader>
        <CardContent>
          <EditPocForm
            pocId={project.id}
            customers={customerOptions}
            partners={partnerOptions}
            initial={{
              title: project.title,
              productName: project.productName,
              productLine: project.productLine,
              deploymentType: project.deploymentType,
              hwSpec: project.hwSpec,
              swSpec: project.swSpec,
              networkNotes: project.networkNotes,
              scheduleAt: project.scheduleAt,
              customerId: project.customerId,
              partnerId: project.partnerId,
            }}
          />
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Checklist</CardTitle></CardHeader>
          <CardContent>
            <PocChecklistActions pocId={project.id} items={project.checklistItems} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Requirements</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <PocRequirementForm pocId={project.id} />
            <div className="space-y-2 text-sm">
              {project.requirementRows.map((r) => (
                <div key={r.id}>
                  <span className="font-medium">{r.label}</span>
                  {r.details ? <span className="text-muted-foreground"> — {r.details}</span> : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Events</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <PocEventForm pocId={project.id} />
            <div className="space-y-2 text-sm">
              {project.events.map((e) => (
                <div key={e.id} className="flex justify-between gap-2">
                  <span>{e.summary}</span>
                  <Badge variant="outline">{e.eventType}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Issues</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <PocIssueForm pocId={project.id} />
            {project.issues.map((issue) => (
              <PocIssueRow key={issue.id} pocId={project.id} issue={issue} />
            ))}
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Result reports</CardTitle>
            <GeneratePocReportButton pocId={project.id} />
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {project.resultReports.length === 0 ? (
              <p className="text-muted-foreground">No reports yet. Generate from checklist, requirements, and issues.</p>
            ) : (
              project.resultReports.map((report) => (
                <div key={report.id} className="rounded-md border p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium">{report.title}</span>
                    <Badge>{report.status}</Badge>
                  </div>
                  <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{report.bodyMarkdown}</pre>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
