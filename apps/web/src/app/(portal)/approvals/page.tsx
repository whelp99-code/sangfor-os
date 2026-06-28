export const dynamic = "force-dynamic";

import {
  type RevenueApprovalItem,
  filterRevenueApprovalQueue,
} from "@sangfor/business";
import { type Prisma, prisma } from "@sangfor/db";
import Link from "next/link";

import {
  type RevenueApprovalFilterValues,
  RevenueApprovalFilters,
} from "@/components/approvals/revenue-approval-filters";
import { AIWorkspaceLayout } from "@/components/ai-workspace";
import { MailCandidateActions } from "@/components/development/mail-candidate-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";

function hasAiRevalidation(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const revalidation = (metadata as Record<string, unknown>).aiRevalidation;
  return Boolean(revalidation && typeof revalidation === "object" && !Array.isArray(revalidation));
}

function isProjectCandidate(candidateType: string) {
  return candidateType === "task" || candidateType === "opportunity" || candidateType === "poc";
}

function metadataRecord(metadata: unknown) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function nestedRecord(metadata: unknown, key: string) {
  const value = metadataRecord(metadata)[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function approvalBadges(candidate: { metadata: unknown; candidateType: string }) {
  const mailIntel = nestedRecord(candidate.metadata, "mailIntelligence");
  const policy = nestedRecord(candidate.metadata, "policyDecision");
  const revalidation = nestedRecord(candidate.metadata, "aiRevalidation");
  return {
    mailIntel: mailIntel.aiEnhanced === true ? "Mail Intel AI" : "Mail Intel Rules",
    policy: `AIOS Policy: ${String(policy.entityRole ?? "unclassified")}`,
    revalidation: `AIOS Revalidation: ${String(
      revalidation.decision ?? (isProjectCandidate(candidate.candidateType) ? "needs_check" : "not_required"),
    )}`,
  };
}

const ACTIVITIES: { id: string; time: string; icon?: React.ReactNode; text: string; type: "success" | "info" | "warning" | "error" }[] = [];

const STATS: { label: string; value: string; type: "success" | "warning" | "error" | "default" }[] = [];

type ApprovalRequestRecord = Prisma.ApprovalRequestGetPayload<Record<string, never>>;
type MailDerivedCandidateRecord = Prisma.MailDerivedCandidateGetPayload<Record<string, never>>;

type RevenueApprovalQueueItem = RevenueApprovalItem & {
  customer: string;
  title: string;
  amountKrw: string;
  marginPercent: number;
  discountPercent: number;
  requestedBy: string;
  metadata: string[];
};

const REVENUE_APPROVAL_QUEUE: RevenueApprovalQueueItem[] = [];

const OWNER_ROLES = ["all", "sales", "presales", "cfo"] as const;
const ITEM_TYPES = ["all", "quote", "proposal", "discount"] as const;
const STATUSES = ["all", "draft", "ready_for_human_approval", "approved", "rejected"] as const;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function pickParam<const T extends readonly string[]>(
  value: string | string[] | undefined,
  allowedValues: T,
): T[number] {
  const firstValue = Array.isArray(value) ? value[0] : value;
  return allowedValues.includes(firstValue ?? "") ? firstValue! : allowedValues[0];
}

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const revenueFilters: RevenueApprovalFilterValues = {
    ownerRole: pickParam(params.ownerRole, OWNER_ROLES),
    itemType: pickParam(params.itemType, ITEM_TYPES),
    status: pickParam(params.status, STATUSES),
  };
  const filteredRevenueApprovals = filterRevenueApprovalQueue(REVENUE_APPROVAL_QUEUE, {
    ownerRole: revenueFilters.ownerRole === "all" ? undefined : revenueFilters.ownerRole,
    itemType: revenueFilters.itemType === "all" ? undefined : revenueFilters.itemType,
    status: revenueFilters.status === "all" ? undefined : revenueFilters.status,
  });

  const approvals = await prisma.approvalRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
  }) as ApprovalRequestRecord[];
  const customerPartnerCandidates = await prisma.mailDerivedCandidate.findMany({
    where: { status: "proposed", candidateType: { in: ["customer", "partner"] } },
    orderBy: [{ confidence: "desc" }, { sourceReceivedAt: "desc" }, { createdAt: "desc" }],
    take: 50,
  }) as MailDerivedCandidateRecord[];
  const rawProjectCandidates = await prisma.mailDerivedCandidate.findMany({
    where: { status: "proposed", candidateType: { in: ["task", "opportunity", "poc"] } },
    orderBy: [{ confidence: "desc" }, { sourceReceivedAt: "desc" }, { createdAt: "desc" }],
    take: 1_000,
  }) as MailDerivedCandidateRecord[];

  const mailCandidates = [...customerPartnerCandidates, ...rawProjectCandidates.filter((candidate) =>
    hasAiRevalidation(candidate.metadata)
  )]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 50);
  const pending = approvals.filter((a) => a.status === "pending").length;
  const totalPending = pending + mailCandidates.length;

  return (
    <AIWorkspaceLayout
      title="승인 관리"
      subtitle={`Review mail-derived project candidates and gated automation. ${totalPending} awaiting approval.`}
      activities={ACTIVITIES}
      stats={STATS}
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-medium">Revenue approval queue</h2>
            <p className="text-sm text-muted-foreground">
              Cursor-role commercial approval metadata for quotes, proposals, and discount exceptions.
            </p>
          </div>
          <RevenueApprovalFilters
            filters={revenueFilters}
            filteredCount={filteredRevenueApprovals.length}
            totalCount={REVENUE_APPROVAL_QUEUE.length}
          />
          <div className="grid gap-3">
            {filteredRevenueApprovals.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">
                  No revenue approvals match this filter.
                </CardContent>
              </Card>
            ) : (
              filteredRevenueApprovals.map((item) => (
                <Card key={item.id}>
                  <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{item.ownerRole}</Badge>
                        <Badge variant="outline">{item.itemType}</Badge>
                        <Badge variant={item.status === "ready_for_human_approval" ? "default" : "secondary"}>
                          {item.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {item.priority} priority · requested by {item.requestedBy}
                        </span>
                      </div>
                      <CardTitle className="break-words text-base">{item.title}</CardTitle>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-medium">{item.amountKrw}</p>
                      <p className="text-muted-foreground">Margin {item.marginPercent}%</p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="text-muted-foreground">
                      {item.customer} · Discount {item.discountPercent}% · metadata/status preview only
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {item.metadata.map((tag) => (
                        <Badge key={tag} variant="outline">{tag}</Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-medium">Mail candidate approval queue</h2>
              <p className="text-sm text-muted-foreground">
                Customer and partner candidates are auto-derived for final approval. Project-like
                candidates appear here only after AIOS AI revalidation.
              </p>
            </div>
            <Link
              href="/development/mail-candidates"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Candidate workspace
            </Link>
          </div>
          <div className="grid gap-3">
            {mailCandidates.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">
                  No mail candidates are waiting. Generate candidates from mail intelligence first.
                </CardContent>
              </Card>
            ) : (
              mailCandidates.map((candidate) => {
                const badges = approvalBadges(candidate);
                return (
                  <Card key={candidate.id}>
                    <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">{candidate.candidateType}</Badge>
                          <Badge variant="outline">pending</Badge>
                          <Badge variant="outline">{badges.mailIntel}</Badge>
                          <Badge variant="outline">{badges.policy}</Badge>
                          <Badge variant="outline">{badges.revalidation}</Badge>
                          <span className="text-xs text-muted-foreground">
                            confidence {candidate.confidence}
                          </span>
                        </div>
                        <CardTitle className="break-words text-base">
                          <Link
                            href={`/approvals/mail-candidates/${candidate.id}`}
                            className="hover:underline"
                          >
                            {candidate.title}
                          </Link>
                        </CardTitle>
                      </div>
                      <MailCandidateActions candidateId={candidate.id} status={candidate.status} />
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <p className="line-clamp-3 break-words text-muted-foreground">
                        {candidate.summary}
                      </p>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <span className="break-words">Source: {candidate.sourceTitle ?? "mail thread"}</span>
                        <span>Sender: {candidate.sourceSender ?? "unknown"}</span>
                        <Link
                          href={`/approvals/mail-candidates/${candidate.id}`}
                          className="text-primary hover:underline"
                        >
                          Review detail
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </section>

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-medium">Automation approvals</h2>
            <p className="text-sm text-muted-foreground">
              Risk-gated command runs and PR approval requests.
            </p>
          </div>
          <div className="grid gap-3">
          {approvals.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                No automation approval requests yet.
              </CardContent>
            </Card>
          ) : (
            approvals.map((approval) => (
              <Card key={approval.id}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">{approval.reason ?? "Review required"}</CardTitle>
                  <Badge variant={approval.status === "pending" ? "outline" : "secondary"}>
                    {approval.status}
                  </Badge>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  Command run: {approval.commandRunId ?? "—"} · PR: {approval.pullRequestId ?? "—"}
                </CardContent>
              </Card>
            ))
          )}
          </div>
        </section>
      </div>
    </AIWorkspaceLayout>
  );
}
