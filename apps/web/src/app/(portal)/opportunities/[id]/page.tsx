import {
  enrichOpportunityLinks,
  getEngagementByOpportunity,
  getOpportunityDetail,
  listCustomers,
  listGeneratedDocuments,
  listMailEvidenceForEntity,
  listPartners,
  listPocProjects,
  normalizeOpportunityStage,
} from "@sangfor/business";
import { buildOpportunityOrchestratorSummary } from "@sangfor/business/skills";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  AddOpportunityLinkForm,
  RemoveOpportunityLinkButton,
} from "@/components/opportunities/add-link-form";
import { MailEvidenceCard } from "@/components/mail-candidates/mail-evidence-card";
import { AdvanceOpportunityButton } from "@/components/opportunities/advance-button";
import { ConvertToProjectButton } from "@/components/opportunities/convert-to-project-button";
import { DealRecordHeader, DealStagePath } from "@/components/deals/deal-record-header";
import { EditOpportunityForm } from "@/components/opportunities/edit-opportunity-form";
import { PortalOrchestratorRunPanel } from "@/components/phase13/portal-orchestrator-run-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type PageProps = { params: Promise<{ id: string }> };

export default async function OpportunityDetailPage({ params }: PageProps) {
  const { id } = await params;
  const [opportunity, customers, partners, pocProjects, proposals, mailEvidence] = await Promise.all([
    getOpportunityDetail(id),
    listCustomers(),
    listPartners(),
    listPocProjects(),
    listGeneratedDocuments(),
    listMailEvidenceForEntity("opportunity", id),
  ]);
  if (!opportunity) notFound();

  const existingEngagement = await getEngagementByOpportunity(id);
  const stage = normalizeOpportunityStage(opportunity.stage);
  const enrichedLinks = await enrichOpportunityLinks(opportunity.links);
  const customerOptions = customers.map((c) => ({ id: c.id, label: c.name }));
  const partnerOptions = partners.map((p) => ({ id: p.id, label: p.name }));

  return (
    <div className="space-y-6">
      <DealRecordHeader
        title={opportunity.title}
        stage={stage}
        probability={opportunity.probability}
        amount={opportunity.amount?.toString() ?? null}
        customer={opportunity.customer?.name ?? null}
        partner={opportunity.partner?.name ?? null}
        nextAction={opportunity.nextAction}
        closeDate={opportunity.closeDate}
        actions={
          <>
            <Badge>{stage}</Badge>
            <Badge variant="outline">{opportunity.probability}%</Badge>
            <AdvanceOpportunityButton id={opportunity.id} stage={opportunity.stage} />
            <ConvertToProjectButton id={opportunity.id} engagementId={existingEngagement?.id} />
          </>
        }
      />
      <DealStagePath stage={stage} />
      <PortalOrchestratorRunPanel
        title="Phase 13 orchestrator"
        buttonLabel="Run orchestrator"
        inputSummary={buildOpportunityOrchestratorSummary(opportunity)}
        sourceEntityType="opportunity"
        sourceEntityId={opportunity.id}
      />
      <MailEvidenceCard evidence={mailEvidence} />
      <Card>
        <CardHeader><CardTitle>Edit opportunity</CardTitle></CardHeader>
        <CardContent>
          <EditOpportunityForm
            opportunityId={opportunity.id}
            customers={customerOptions}
            partners={partnerOptions}
            initial={{
              title: opportunity.title,
              stage: opportunity.stage,
              amount: opportunity.amount?.toString() ?? null,
              probability: opportunity.probability,
              closeDate: opportunity.closeDate,
              nextAction: opportunity.nextAction,
              customerId: opportunity.customerId,
              partnerId: opportunity.partnerId,
            }}
          />
        </CardContent>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Stage history</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {opportunity.stageEvents.map((e) => (
              <div key={e.id} className="flex justify-between">
                <span>{e.fromStage ?? "—"} → {e.toStage}</span>
                <Badge variant="outline">{e.note ?? ""}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Linked entities</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <AddOpportunityLinkForm
              opportunityId={opportunity.id}
              linkOptions={{
                poc: pocProjects.map((p) => ({ id: p.id, label: p.title })),
                proposal: proposals.map((d) => ({ id: d.id, label: d.title })),
                partner: partnerOptions,
                customer: customerOptions,
              }}
            />
            <div className="space-y-2 text-sm">
              {enrichedLinks.length === 0 ? (
                <p className="text-muted-foreground">No links yet.</p>
              ) : (
                enrichedLinks.map((link) => (
                  <div key={link.id} className="flex items-center justify-between gap-2">
                    <span>
                      {link.href ? (
                        <Link href={link.href} className="hover:underline">
                          {link.entityType}: {link.label}
                        </Link>
                      ) : (
                        `${link.entityType}: ${link.label}`
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <Badge variant="secondary">{link.linkType}</Badge>
                      <RemoveOpportunityLinkButton opportunityId={opportunity.id} linkId={link.id} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
