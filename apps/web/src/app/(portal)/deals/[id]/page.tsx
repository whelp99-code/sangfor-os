import {
  computeDealRisk,
  enrichOpportunityLinks,
  getEngagementByOpportunity,
  getOpportunityDetail,
  getPocDetail,
  listCustomers,
  listGeneratedDocuments,
  listMailEvidenceForEntity,
  listPartners,
  listPocProjects,
  listQuotesByOpportunity,
  normalizeOpportunityStage,
} from "@sangfor/business";
import { buildOpportunityOrchestratorSummary } from "@sangfor/business/skills";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Edit, ActivitySquare, Gauge } from "lucide-react";

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
import { DealDetailTabs } from "@/components/deals/deal-detail-tabs";
import { DEAL_DETAIL_TABS, type DealDetailTab } from "@/components/deals/deal-detail-tabs.constants";
import { winProbabilityLabel } from "@/components/deals/win-probability";
import { DealWorkTab } from "@/components/deals/deal-work-tab";
import { RegistrationPanel } from "@/components/deals/registration-panel";
import { PortalOrchestratorRunPanel } from "@/components/phase13/portal-orchestrator-run-panel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
};

function daysSince(from: Date | null | undefined): number | null {
  if (!from) return null;
  return Math.floor((Date.now() - from.getTime()) / (1000 * 60 * 60 * 24));
}

export default async function DealDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  const activeTab: DealDetailTab = DEAL_DETAIL_TABS.includes(tabParam as DealDetailTab)
    ? (tabParam as DealDetailTab)
    : "작업";
  // getEngagementByOpportunity depends only on `id`, so it joins the initial
  // parallel batch instead of running as a sequential await afterwards (−1 round-trip).
  const [
    opportunity,
    customers,
    partners,
    pocProjects,
    proposals,
    mailEvidence,
    rawQuotes,
    existingEngagement,
  ] = await Promise.all([
    getOpportunityDetail(id),
    listCustomers(),
    listPartners(),
    listPocProjects(),
    listGeneratedDocuments(),
    listMailEvidenceForEntity("opportunity", id),
    listQuotesByOpportunity(id),
    getEngagementByOpportunity(id),
  ]);
  if (!opportunity) notFound();

  // Serialize Decimal fields to string for the BidWorkPanel (crosses RSC boundary).
  const quotes = rawQuotes.map((q) => ({
    id: q.id,
    status: q.status,
    version: q.version,
    totalRevenue: q.totalRevenue?.toString() ?? "0",
    marginPct: q.marginPct?.toString() ?? "0",
    createdAt: q.createdAt,
  }));

  const sprStatus = opportunity.dealRegistration?.sprStatus ?? null;
  const distributorName =
    opportunity.distributor?.name ??
    opportunity.dealRegistration?.distributor?.name ??
    null;
  const competitors: string[] = [];

  // Serialize Decimal fields and dates for the WinWorkPanel (crosses RSC boundary).
  const winEngagement = existingEngagement
    ? {
        id: existingEngagement.id,
        name: existingEngagement.name,
        status: existingEngagement.status,
        summaryMarkdown: existingEngagement.summaryMarkdown ?? null,
        sowApprovedAt: existingEngagement.sowApprovedAt
          ? existingEngagement.sowApprovedAt.toISOString()
          : null,
      }
    : null;

  // Serialize checklist items for the DeliveryWorkPanel (crosses RSC boundary).
  const deliveryChecklistItems = existingEngagement
    ? existingEngagement.checklistItems.map((item) => ({
        id: item.id,
        itemKey: item.itemKey,
        status: item.status,
        completedAt: item.completedAt ? item.completedAt.toISOString() : null,
      }))
    : [];

  const stage = normalizeOpportunityStage(opportunity.stage);
  const dwellFrom = opportunity.stageEnteredAt ?? opportunity.createdAt;
  const stageDwellDays = Math.max(0, daysSince(dwellFrom) ?? 0);
  const overdueDays = daysSince(opportunity.closeDate);
  const dealRisk = computeDealRisk({
    stageDwellDays,
    amount: opportunity.amount != null ? Number(opportunity.amount) : null,
    probability: opportunity.probability,
    mailSilenceDays: null,
    lensFailCount: 0,
    stage: opportunity.stage,
    overdueDays,
    hasNextAction: Boolean(opportunity.nextAction && opportunity.nextAction.trim()),
  });
  const enrichedLinks = await enrichOpportunityLinks(opportunity.links);
  const customerOptions = customers.map((c) => ({ id: c.id, label: c.name }));
  const partnerOptions = partners.map((p) => ({ id: p.id, label: p.name }));

  // Filter PoC projects linked to this opportunity, then fetch full detail for
  // the work panels (checklist items, issues, result reports).
  const linkedPocSlugs = pocProjects.filter((p) => p.opportunityId === id);
  const linkedPocDetails = await Promise.all(
    linkedPocSlugs.map((p) => getPocDetail(p.id))
  );
  const resolvedPocDetails = linkedPocDetails.filter(
    (p): p is NonNullable<typeof p> => p !== null
  );

  const pocProjectsForPanel = resolvedPocDetails.map((poc) => ({
    id: poc.id,
    title: poc.title,
    status: poc.status,
    productName: poc.productName,
    customer: poc.customer ? { name: poc.customer.name } : null,
    checklistItems: poc.checklistItems.map((item) => ({
      id: item.id,
      label: item.label,
      done: item.done,
    })),
    issues: poc.issues.map((issue) => ({
      id: issue.id,
      title: issue.title,
      severity: issue.severity,
      status: issue.status,
    })),
  }));

  const pocProjectsWithResults = resolvedPocDetails.map((poc) => ({
    id: poc.id,
    title: poc.title,
    status: poc.status,
    customer: poc.customer ? { name: poc.customer.name } : null,
    resultReports: poc.resultReports.map((r) => ({
      id: r.id,
      title: r.title,
      bodyMarkdown: r.bodyMarkdown,
      status: r.status,
      createdAt: r.createdAt,
    })),
    checklistDone: poc.checklistItems.filter((item) => item.done).length,
    checklistTotal: poc.checklistItems.length,
  }));

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
        closeDate={opportunity.closeDate ? new Date(opportunity.closeDate).toISOString() : null}
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
            <Badge variant="outline">{winProbabilityLabel(opportunity.probability, stage)}</Badge>
            <Link
              href={`/deals/${opportunity.id}?tab=상세`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="딜 상세 편집"
            >
              <Edit className="size-3.5" aria-hidden="true" />
              편집
            </Link>
            <Link
              href={`/deals/${opportunity.id}?tab=활동`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="활동 기록 보기"
            >
              <ActivitySquare className="size-3.5" aria-hidden="true" />
              활동 기록
            </Link>
            <AdvanceOpportunityButton id={opportunity.id} stage={opportunity.stage} />
            <ConvertToProjectButton id={opportunity.id} engagementId={existingEngagement?.id} />
          </>
        }
      />
      <DealStagePath stage={stage} />
      <DealStageGuide stage={stage} />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <DealDetailTabs defaultTab={activeTab} className="space-y-0">
        <TabsList variant="line" className="w-full justify-start border-b rounded-none px-2 pb-0 h-auto">
          <TabsTrigger value="작업">작업</TabsTrigger>
          <TabsTrigger value="상세">상세</TabsTrigger>
          <TabsTrigger value="문서">문서</TabsTrigger>
          <TabsTrigger value="연락처">연결 항목</TabsTrigger>
          <TabsTrigger value="채널·등록">채널·등록</TabsTrigger>
          <TabsTrigger value="활동">활동</TabsTrigger>
        </TabsList>

        {/* 작업 tab: stage work panel + stage history */}
        <TabsContent value="작업" className="space-y-4 pt-4">
          <DealWorkTab
            opportunity={{
              id: opportunity.id,
              title: opportunity.title,
              stage: opportunity.stage,
            }}
            proposals={proposals.map((p) => ({
              id: p.id,
              title: p.title,
              status: p.status,
              createdAt: p.createdAt,
              opportunityId: p.opportunityId ?? null,
              bodyMarkdown: p.bodyMarkdown,
              customer: p.customer ? { name: p.customer.name } : null,
              template: p.template
                ? { templateKey: p.template.templateKey, title: p.template.title }
                : null,
            }))}
            pocProjects={pocProjectsForPanel}
            pocProjectsWithResults={pocProjectsWithResults}
            bid={{ quotes, sprStatus, distributorName, competitors }}
            win={{
              engagement: winEngagement,
              amount: opportunity.amount?.toString() ?? null,
              distributorName,
            }}
            delivery={{
              engagementId: existingEngagement?.id ?? null,
              opportunityId: opportunity.id,
              checklistItems: deliveryChecklistItems,
            }}
          />
          <Card>
            <CardHeader><CardTitle>단계 이력</CardTitle></CardHeader>
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
              closeDate: opportunity.closeDate
                ? new Date(opportunity.closeDate).toISOString()
                : null,
              dealRegistration: opportunity.dealRegistration
                ? {
                    ...opportunity.dealRegistration,
                    protectionExpiresAt:
                      opportunity.dealRegistration.protectionExpiresAt
                        ? new Date(opportunity.dealRegistration.protectionExpiresAt).toISOString()
                        : null,
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

        {/* Tab value stays "연락처" for URL compat; visible label is "연결 항목". */}
        <TabsContent value="연락처" className="space-y-4 pt-4">
          <Card>
            <CardHeader><CardTitle>연결 항목</CardTitle></CardHeader>
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
                  <p className="text-muted-foreground">아직 연결된 항목이 없습니다.</p>
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
                    protectionExpiresAt: opportunity.dealRegistration.protectionExpiresAt
                      ? new Date(opportunity.dealRegistration.protectionExpiresAt).toISOString()
                      : null,
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
            distributorOptions={
              // Only DISTRIBUTOR partners (or unclassified) are valid distributor choices.
              partners
                .filter((p) => p.kind === "DISTRIBUTOR" || p.kind == null)
                .map((p) => ({ id: p.id, label: p.name }))
            }
          />
        </TabsContent>

        {/* 활동 tab (H-4): full-width activity timeline reusing stage history events */}
        <TabsContent value="활동" className="pt-4">
          <Card>
            <CardHeader>
              <CardTitle>활동 타임라인</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {opportunity.stageEvents.length === 0 ? (
                <p className="text-muted-foreground">활동 기록이 없습니다.</p>
              ) : (
                <ol className="relative border-l border-border ml-2 space-y-4" aria-label="활동 타임라인">
                  {opportunity.stageEvents.map((e) => (
                    <li key={e.id} className="pl-5 relative">
                      <span
                        className="absolute -left-[5px] top-1.5 size-2.5 rounded-full border-2 border-background bg-primary"
                        aria-hidden="true"
                      />
                      <div className="flex flex-col gap-0.5">
                        <span className="font-semibold">
                          {e.fromStage ?? "시작"}{" "}→{" "}{e.toStage}
                        </span>
                        {e.note ? (
                          <span className="text-xs text-muted-foreground">{e.note}</span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </DealDetailTabs>

      <div className="space-y-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
              <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
            <CardTitle className="text-base">리스크 스코어</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {dealRisk.factors.length === 1 && dealRisk.factors[0]?.key === "terminal" ? (
              <p className="text-sm text-muted-foreground">{dealRisk.factors[0].note}</p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-foreground/60" style={{ width: `${dealRisk.score}%` }} />
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {dealRisk.score}점 · {dealRisk.level === "high" ? "높음" : dealRisk.level === "medium" ? "중간" : "낮음"}
                  </span>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {dealRisk.factors.map((factor) => (
                    <li key={factor.key}>{factor.label}: {factor.note}</li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
        <DealAiRail stage={stage} />
        <PortalOrchestratorRunPanel
          title="Phase 13 오케스트레이터"
          buttonLabel="오케스트레이터 실행"
          inputSummary={buildOpportunityOrchestratorSummary(opportunity)}
          sourceEntityType="opportunity"
          sourceEntityId={opportunity.id}
        />
      </div>
      </div>
    </div>
  );
}
