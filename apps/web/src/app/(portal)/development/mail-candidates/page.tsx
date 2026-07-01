export const dynamic = "force-dynamic";

import Link from "next/link";

import { prisma } from "@sangfor/db";

import {
  GenerateMailCandidatesButton,
  MailCandidateActions,
} from "@/components/development/mail-candidate-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const entityHref: Record<string, string> = {
  customer: "/customers",
  partner: "/partners",
  task: "/tasks",
  opportunity: "/opportunities",
  poc: "/poc",
};

function formatDate(value?: Date | null) {
  if (!value) return "날짜 미상";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

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

function statusBadges(candidate: { metadata: unknown; status: string; candidateType: string }) {
  const mailIntel = nestedRecord(candidate.metadata, "mailIntelligence");
  const policy = nestedRecord(candidate.metadata, "policyDecision");
  const revalidation = nestedRecord(candidate.metadata, "aiRevalidation");
  const aiEnhanced = mailIntel.aiEnhanced === true;
  const policyRole = String(policy.entityRole ?? "unclassified");
  const revalidationDecision = String(revalidation.decision ?? (
    isProjectCandidate(candidate.candidateType) ? "needs_check" : "not_required"
  ));
  return {
    mailIntel: aiEnhanced ? "Mail Intel AI" : "Mail Intel 규칙",
    policy: `AIOS 정책: ${policyRole}`,
    revalidation: `AIOS 재검증: ${revalidationDecision}`,
    human: `사람 승인: ${candidate.status}`,
  };
}

export default async function MailCandidatesPage() {
  const [candidates, allCandidateSummaries, threadCount, policyMemoryCount, businessCounts] = await Promise.all([
    prisma.mailDerivedCandidate.findMany({
      where: { status: { notIn: ["knowledge_only", "rejected"] } },
      orderBy: [{ status: "asc" }, { confidence: "desc" }, { createdAt: "desc" }],
      take: 100,
    }),
    prisma.mailDerivedCandidate.findMany({
      select: { status: true, candidateType: true, metadata: true },
    }),
    prisma.mailInsightThread.count(),
    prisma.policyMemory.count({ where: { status: { in: ["active", "approved", "proposed"] } } }),
    Promise.all([
      prisma.customer.count(),
      prisma.partner.count(),
      prisma.workTask.count(),
      prisma.opportunity.count(),
      prisma.pocProject.count(),
    ]),
  ]);
  const needsRevalidation = allCandidateSummaries.filter((candidate) =>
    candidate.status === "needs_revalidation" ||
    (candidate.status === "proposed" &&
      isProjectCandidate(candidate.candidateType) &&
      !hasAiRevalidation(candidate.metadata))
  ).length;
  const proposed = allCandidateSummaries.filter((candidate) =>
    candidate.status === "proposed" &&
    (!isProjectCandidate(candidate.candidateType) || hasAiRevalidation(candidate.metadata))
  ).length;
  const converted = allCandidateSummaries.filter((candidate) => candidate.status === "converted").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-normal">메일 후보 관리</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Mail Intelligence 스레드 인사이트는 정책 메모리, 근거 검증, AIOS 재검증, 최종 사람 승인을
            거쳐 AIOS 후보로 전환됩니다.
          </p>
        </div>
        <GenerateMailCandidatesButton />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">스레드 인사이트</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{threadCount}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">제안됨</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{proposed}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">AI 확인 필요</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{needsRevalidation}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">전환됨</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{converted}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">정책 메모리</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{policyMemoryCount}</CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="py-3 text-xs text-muted-foreground">
          생성된 객체: 고객 {businessCounts[0]} · 파트너 {businessCounts[1]} ·{" "}
          작업 {businessCounts[2]} · 기회 {businessCounts[3]} · PoC {businessCounts[4]}
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {candidates.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">
              아직 메일 후보가 없습니다. 우측 상단의 생성 버튼으로 가져온 Mail Intelligence 캐시에서 후보를 생성하세요.
            </CardContent>
          </Card>
        ) : (
          candidates.map((candidate) => {
            const badges = statusBadges(candidate);
            return (
              <Card key={candidate.id}>
                <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{candidate.candidateType}</Badge>
                      <Badge variant={candidate.status === "converted" ? "secondary" : "outline"}>
                        {candidate.status}
                      </Badge>
                      <Badge variant="outline">{badges.mailIntel}</Badge>
                      <Badge variant="outline">{badges.policy}</Badge>
                      <Badge variant="outline">{badges.revalidation}</Badge>
                      <Badge variant="outline">{badges.human}</Badge>
                      <span className="text-xs text-muted-foreground">
                        신뢰도 {candidate.confidence}
                      </span>
                    </div>
                    <CardTitle className="break-words text-base">{candidate.title}</CardTitle>
                  </div>
                  <MailCandidateActions
                    candidateId={candidate.id}
                    status={candidate.status}
                    requiresAiCheck={isProjectCandidate(candidate.candidateType) && !hasAiRevalidation(candidate.metadata)}
                  />
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="break-words text-muted-foreground">{candidate.summary}</p>
                  <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <span className="break-words">출처: {candidate.sourceTitle ?? "메일 스레드"}</span>
                    <span className="break-words">발신자: {candidate.sourceSender ?? "알 수 없음"}</span>
                    <span>수신: {formatDate(candidate.sourceReceivedAt)}</span>
                    {candidate.createdEntityId && candidate.createdEntityType ? (
                      <Link
                        className="text-primary hover:underline"
                        href={entityHref[candidate.createdEntityType] ?? "/development/mail-candidates"}
                      >
                        생성된 {candidate.createdEntityType}: {candidate.createdEntityId.slice(0, 8)}
                      </Link>
                    ) : (
                      <span>생성된 객체: 없음</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
