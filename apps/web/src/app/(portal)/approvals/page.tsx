export const dynamic = "force-dynamic";

import { prisma } from "@ai-portal/db";
import Link from "next/link";

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

export default async function ApprovalsPage() {
  const [approvals, customerPartnerCandidates, rawProjectCandidates] = await Promise.all([
    prisma.approvalRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.mailDerivedCandidate.findMany({
      where: { status: "proposed", candidateType: { in: ["customer", "partner"] } },
      orderBy: [{ confidence: "desc" }, { sourceReceivedAt: "desc" }, { createdAt: "desc" }],
      take: 50,
    }),
    prisma.mailDerivedCandidate.findMany({
      where: { status: "proposed", candidateType: { in: ["task", "opportunity", "poc"] } },
      orderBy: [{ confidence: "desc" }, { sourceReceivedAt: "desc" }, { createdAt: "desc" }],
      take: 1_000,
    }),
  ]);

  const mailCandidates = [...customerPartnerCandidates, ...rawProjectCandidates.filter((candidate) =>
    hasAiRevalidation(candidate.metadata)
  )]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 50);
  const pending = approvals.filter((a) => a.status === "pending").length;
  const totalPending = pending + mailCandidates.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">승인 관리</h1>
        <p className="text-muted-foreground">
          Review mail-derived project candidates and gated automation. {totalPending} awaiting approval.
        </p>
      </div>

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
  );
}
