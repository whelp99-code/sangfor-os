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
    mailIntel: mailIntel.aiEnhanced === true ? "Mail Intel AI" : "Mail Intel 규칙",
    policy: `AIOS 정책: ${String(policy.entityRole ?? "unclassified")}`,
    revalidation: `AIOS 재검증: ${String(
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

  const [approvals, customerPartnerCandidates, rawProjectCandidates] = await Promise.all([
    prisma.approvalRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }) as Promise<ApprovalRequestRecord[]>,
    prisma.mailDerivedCandidate.findMany({
      where: { status: "proposed", candidateType: { in: ["customer", "partner"] } },
      orderBy: [{ confidence: "desc" }, { sourceReceivedAt: "desc" }, { createdAt: "desc" }],
      take: 50,
    }) as Promise<MailDerivedCandidateRecord[]>,
    prisma.mailDerivedCandidate.findMany({
      where: { status: "proposed", candidateType: { in: ["task", "opportunity", "poc"] } },
      orderBy: [{ confidence: "desc" }, { sourceReceivedAt: "desc" }, { createdAt: "desc" }],
      take: 50,
    }) as Promise<MailDerivedCandidateRecord[]>,
  ]);

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
      subtitle={`메일 기반 프로젝트 후보와 게이트 자동화를 검토합니다. 승인 대기 ${totalPending}건.`}
      activities={ACTIVITIES}
      stats={STATS}
    >
      <div className="space-y-6">
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-medium">매출 승인 큐</h2>
            <p className="text-sm text-muted-foreground">
              견적·제안·할인 예외에 대한 역할별 상업 승인 메타데이터입니다.
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
                  이 필터에 해당하는 매출 승인이 없습니다.
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
                          {item.priority} 우선순위 · 요청자 {item.requestedBy}
                        </span>
                      </div>
                      <CardTitle className="break-words text-base">{item.title}</CardTitle>
                    </div>
                    <div className="text-right text-sm">
                      <p className="font-medium">{item.amountKrw}</p>
                      <p className="text-muted-foreground">마진 {item.marginPercent}%</p>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p className="text-muted-foreground">
                      {item.customer} · 할인 {item.discountPercent}% · 메타데이터/상태 미리보기 전용
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
              <h2 className="text-lg font-medium">메일 후보 승인 큐</h2>
              <p className="text-sm text-muted-foreground">
                고객·파트너 후보는 최종 승인을 위해 자동 도출됩니다. 프로젝트성 후보는 AIOS AI
                재검증을 거친 뒤에만 여기에 표시됩니다.
              </p>
            </div>
            <Link
              href="/development/mail-candidates"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              후보 워크스페이스
            </Link>
          </div>
          <div className="grid gap-3">
            {mailCandidates.length === 0 ? (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">
                  대기 중인 메일 후보가 없습니다. 먼저 Mail Intelligence에서 후보를 생성하세요.
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
                          <Badge variant="outline">대기</Badge>
                          <Badge variant="outline">{badges.mailIntel}</Badge>
                          <Badge variant="outline">{badges.policy}</Badge>
                          <Badge variant="outline">{badges.revalidation}</Badge>
                          <span className="text-xs text-muted-foreground">
                            신뢰도 {candidate.confidence}
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
                        <span className="break-words">출처: {candidate.sourceTitle ?? "메일 스레드"}</span>
                        <span>발신자: {candidate.sourceSender ?? "알 수 없음"}</span>
                        <Link
                          href={`/approvals/mail-candidates/${candidate.id}`}
                          className="text-primary hover:underline"
                        >
                          상세 검토
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
            <h2 className="text-lg font-medium">자동화 승인</h2>
            <p className="text-sm text-muted-foreground">
              리스크 게이트가 적용된 명령 실행 및 PR 승인 요청입니다.
            </p>
          </div>
          <div className="grid gap-3">
          {approvals.length === 0 ? (
            <Card>
              <CardContent className="py-6 text-sm text-muted-foreground">
                아직 자동화 승인 요청이 없습니다.
              </CardContent>
            </Card>
          ) : (
            approvals.map((approval) => (
              <Card key={approval.id}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle className="text-base">{approval.reason ?? "검토 필요"}</CardTitle>
                  <Badge variant={approval.status === "pending" ? "outline" : "secondary"}>
                    {approval.status}
                  </Badge>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground">
                  명령 실행: {approval.commandRunId ?? "—"} · PR: {approval.pullRequestId ?? "—"}
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
