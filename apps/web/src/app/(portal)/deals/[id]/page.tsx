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
import { DealStageGuide } from "@/components/deals/deal-stage-guide";
import { DealAiRail } from "@/components/deals/deal-ai-rail";
import { DealDetail } from "@/components/deals/deal-detail";
import { RegistrationPanel } from "@/components/deals/registration-panel";
import { PortalOrchestratorRunPanel } from "@/components/phase13/portal-orchestrator-run-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PageProps = { params: Promise<{ id: string }> };

export default async function DealDetailPage({ params }: PageProps) {
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
    <div className="space-y-4">
      <DealRecordHeader
        title={opportunity.title}
        stage={stage}
        probability={opportunity.probability}
        amount={opportunity.amount?.toString() ?? null}
        customer={opportunity.customer?.name ?? null}
        partner={
          opportunity.dealRegistration?.distributor?.name ??
          opportunity.distributor?.name ??
          opportunity.partner?.name ??
          null
        }
        nextAction={opportunity.nextAction}
        closeDate={opportunity.closeDate}
        regStatus={
          (opportunity.dealRegistration?.regStatus ?? null) as
            | "NOT_SUBMITTED"
            | "SUBMITTED"
            | "APPROVED"
            | "REJECTED"
            | "EXPIRED"
            | "CONTESTED"
            | null
        }
        protectionExpiresAt={
          opportunity.dealRegistration?.protectionExpiresAt
            ? new Date(opportunity.dealRegistration.protectionExpiresAt).toISOString()
            : null
        }
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
      <DealStageGuide stage={stage} />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <Tabs defaultValue="상세" className="space-y-0">
        <TabsList variant="line" className="w-full justify-start border-b rounded-none px-2 pb-0 h-auto">
          <TabsTrigger value="작업">작업</TabsTrigger>
          <TabsTrigger value="상세">상세</TabsTrigger>
          <TabsTrigger value="문서">문서</TabsTrigger>
          <TabsTrigger value="연락처">연락처</TabsTrigger>
          <TabsTrigger value="채널·등록">채널·등록</TabsTrigger>
        </TabsList>

        {/* 작업 tab: orchestrator + stage history */}
        <TabsContent value="작업" className="space-y-4 pt-4">
          <PortalOrchestratorRunPanel
            title="Phase 13 orchestrator"
            buttonLabel="Run orchestrator"
            inputSummary={buildOpportunityOrchestratorSummary(opportunity)}
            sourceEntityType="opportunity"
            sourceEntityId={opportunity.id}
          />
          <Card>
            <CardHeader><CardTitle>Stage history</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {opportunity.stageEvents.length === 0 ? (
                <p className="text-muted-foreground">이력 없음</p>
              ) : (
                opportunity.stageEvents.map((e) => (
                  <div key={e.id} className="flex justify-between">
                    <span>{e.fromStage ?? "—"} → {e.toStage}</span>
                    <Badge variant="outline">{e.note ?? ""}</Badge>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 상세 tab: DealDetail inline editor (default) */}
        <TabsContent value="상세" className="pt-4">
          <DealDetail
            opportunity={{
              ...opportunity,
              dealRegistration: opportunity.dealRegistration
                ? {
                    ...opportunity.dealRegistration,
                    partnerTierMargin:
                      opportunity.dealRegistration.partnerTierMargin != null
                        ? Number(opportunity.dealRegistration.partnerTierMargin)
                        : null,
                  }
                : null,
            }}
          />
        </TabsContent>

        {/* 문서 tab: generated documents / proposals */}
        <TabsContent value="문서" className="pt-4">
          <Card>
            <CardHeader><CardTitle>생성 문서</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {proposals.length === 0 ? (
                <p className="text-muted-foreground">문서 없음</p>
              ) : (
                proposals.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between">
                    <span className="font-medium">{doc.title}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 연락처 tab: linked entities + mail evidence */}
        <TabsContent value="연락처" className="space-y-4 pt-4">
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
          <MailEvidenceCard evidence={mailEvidence} />
        </TabsContent>

        {/* 채널·등록 tab: deal registration panel */}
        <TabsContent value="채널·등록" className="pt-4">
          <RegistrationPanel
            opportunityId={opportunity.id}
            customerName={opportunity.customer?.name ?? null}
            partnerName={
              opportunity.dealRegistration?.distributor?.name ??
              opportunity.distributor?.name ??
              opportunity.partner?.name ??
              null
            }
            dealRegistration={
              opportunity.dealRegistration
                ? {
                    regStatus: opportunity.dealRegistration.regStatus,
                    registrationNumber: opportunity.dealRegistration.registrationNumber,
                    protectionExpiresAt: opportunity.dealRegistration.protectionExpiresAt,
                    sprStatus: opportunity.dealRegistration.sprStatus,
                    partnerTierMargin:
                      opportunity.dealRegistration.partnerTierMargin != null
                        ? Number(opportunity.dealRegistration.partnerTierMargin)
                        : null,
                    distributor: opportunity.dealRegistration.distributor
                      ? {
                          id: opportunity.dealRegistration.distributor.id,
                          name: opportunity.dealRegistration.distributor.name,
                        }
                      : null,
                  }
                : null
            }
            distributorOptions={partners.map((p) => ({ id: p.id, label: p.name }))}
          />
        </TabsContent>
      </Tabs>

      <DealAiRail stage={stage} />
      </div>
    </div>
  );
}
