export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound } from "next/navigation";

import { buildMailCandidateConnectionDefaults } from "@sangfor/business/mail-candidate-connections";
import { prisma } from "@sangfor/db";

import { MailCandidateActions } from "@/components/development/mail-candidate-actions";
import { ApproveConnectForm } from "@/components/mail-candidates/approve-connect-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

type PageProps = {
  params: Promise<{ id: string }>;
};

function formatDate(value?: Date | null) {
  if (!value) return "알 수 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function metadataEntries(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  return Object.entries(metadata as Record<string, unknown>).map(([key, value]) => ({
    key,
    value:
      value && typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : Array.isArray(value)
          ? value.join(", ")
          : String(value ?? ""),
  }));
}

function metadataRecord(metadata: unknown) {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

function aiRevalidation(metadata: unknown) {
  const record = metadataRecord(metadata);
  const revalidation = record.aiRevalidation;
  return revalidation && typeof revalidation === "object" && !Array.isArray(revalidation)
    ? (revalidation as Record<string, unknown>)
    : null;
}

function nestedRecord(metadata: unknown, key: string) {
  const value = metadataRecord(metadata)[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function asObjectArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => (
        item != null && typeof item === "object" && !Array.isArray(item)
      ))
    : [];
}

export default async function MailCandidateApprovalDetailPage({ params }: PageProps) {
  const { id } = await params;
  const candidate = await prisma.mailDerivedCandidate.findUnique({
    where: { id },
    include: { mailInsightThread: true },
  });
  if (!candidate) notFound();

  const sourceDocument = candidate.knowledgeDocumentId
    ? await prisma.knowledgeDocument.findUnique({
        where: { id: candidate.knowledgeDocumentId },
        select: { id: true, title: true, body: true, tags: true, source: true },
      })
    : null;
  const decisionLogs = await prisma.policyDecisionLog.findMany({
    where: { entityType: "mail_derived_candidate", entityId: candidate.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const revalidation = aiRevalidation(candidate.metadata);
  const mailIntelligence = nestedRecord(candidate.metadata, "mailIntelligence");
  const policyDecision = nestedRecord(candidate.metadata, "policyDecision");
  const requiresAiCheck =
    ["task", "opportunity", "poc"].includes(candidate.candidateType) && !revalidation;
  const connectionDefaults = buildMailCandidateConnectionDefaults(candidate);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Link href="/approvals" className="text-sm text-muted-foreground hover:underline">
            승인 목록으로
          </Link>
          <h1 className="break-words text-2xl font-semibold tracking-normal">
            {candidate.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{candidate.candidateType}</Badge>
            <Badge variant={candidate.status === "converted" ? "secondary" : "outline"}>
              {candidate.status}
            </Badge>
            <span className="text-sm text-muted-foreground">
              신뢰도 {candidate.confidence}
            </span>
          </div>
        </div>
        <MailCandidateActions
          candidateId={candidate.id}
          status={candidate.status}
          requiresAiCheck={requiresAiCheck}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader>
            <CardTitle>승인 요약</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="break-words text-muted-foreground">{candidate.summary}</p>
            <div className="grid gap-2 sm:grid-cols-2">
	              <Info label="출처 제목" value={candidate.sourceTitle ?? "메일"} />
	              <Info label="발신자" value={candidate.sourceSender ?? "알 수 없음"} />
	              <Info label="수신 일시" value={formatDate(candidate.sourceReceivedAt)} />
	              <Info label="생성된 엔티티" value={candidate.createdEntityId ?? "미생성"} />
	              <Info label="스레드 키" value={String(mailIntelligence.threadKey ?? candidate.mailInsightThread?.threadKey ?? "알 수 없음")} />
	              <Info label="Mail Intel 모드" value={mailIntelligence.aiEnhanced === true ? "AI 강화" : "규칙/캐시"} />
	            </div>
	          </CardContent>
	        </Card>

        <Card>
          <CardHeader>
            <CardTitle>승인 효과</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              승인하면{" "}
              <span className="font-medium text-foreground">{candidate.candidateType}</span> 유형의
              운영 레코드가 1건 생성됩니다.
            </p>
            {["task", "opportunity", "poc"].includes(candidate.candidateType) ? (
              <p>
                프로젝트성 후보는 이 승인으로 운영 레코드를 생성하기 전에 AIOS AI 재검증이
                필요합니다.
              </p>
            ) : (
              <p>고객·파트너 후보는 자동 도출되지만 여전히 최종 승인이 필요합니다.</p>
            )}
            <p>반려하면 이 후보는 근거로 보존되며 운영 레코드는 생성되지 않습니다.</p>
            {candidate.createdEntityId ? (
              <Link
                href={entityHref(candidate.createdEntityType)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                생성된 레코드 열기
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>승인 후 CRM / 제안서 연결</CardTitle>
        </CardHeader>
        <CardContent>
          <ApproveConnectForm
            candidateId={candidate.id}
            status={candidate.status}
            defaults={connectionDefaults}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
	        <Card>
	          <CardHeader>
	            <CardTitle>Mail Intelligence 근거</CardTitle>
	          </CardHeader>
	          <CardContent className="space-y-4 text-sm">
	            <p className="break-words text-muted-foreground">
	              {String(mailIntelligence.summary ?? candidate.mailInsightThread?.summary ?? candidate.summary)}
	            </p>
	            <div className="grid gap-3 lg:grid-cols-2">
	              <ListBlock
	                title="근거 항목"
	                items={asStringArray(mailIntelligence.evidenceItems ?? candidate.mailInsightThread?.evidenceItems)}
	              />
	              <ListBlock
	                title="다음 액션"
	                items={asObjectArray(mailIntelligence.nextActions ?? candidate.mailInsightThread?.nextActions).map((item) =>
	                  String(item.recommendedAction ?? item.title ?? item.evidence ?? JSON.stringify(item))
	                )}
	              />
	            </div>
	          </CardContent>
	        </Card>

	        <Card>
	          <CardHeader>
	            <CardTitle>AIOS 정책 판정</CardTitle>
	          </CardHeader>
	          <CardContent className="space-y-4 text-sm">
	            <div className="grid gap-2 sm:grid-cols-2">
	              <Info label="판정" value={String(policyDecision.decision ?? "알 수 없음")} />
	              <Info label="엔티티 역할" value={String(policyDecision.entityRole ?? "알 수 없음")} />
	              <Info label="사유" value={String(policyDecision.reason ?? "기록된 정책 사유 없음")} />
	              <Info label="후보 이름" value={String(policyDecision.candidateName ?? "알 수 없음")} />
	            </div>
	            <ListBlock
	              title="일치한 정책 메모리"
	              items={asObjectArray(policyDecision.matchedPolicyMemories).map((item) =>
	                `${String(item.memoryType ?? "메모리")}: ${String(item.label ?? item.key ?? "")}`
	              )}
	            />
	          </CardContent>
	        </Card>
	      </div>

	      <Card>
	        <CardHeader>
          <CardTitle>AI 재검증</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {revalidation ? (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <Info label="판정" value={String(revalidation.decision ?? "알 수 없음")} />
                <Info label="모드" value={String(revalidation.mode ?? "알 수 없음")} />
                <Info label="신뢰도" value={String(revalidation.confidence ?? candidate.confidence)} />
              </div>
              <p className="break-words text-muted-foreground">
                {String(revalidation.reasoningSummary ?? "추론 요약 없음.")}
              </p>
              <div className="grid gap-3 lg:grid-cols-3">
                <ListBlock title="근거" items={asObjectArray(revalidation.evidence).map((item) =>
                  `${String(item.sourceType ?? "출처")}: ${String(item.quoteOrSummary ?? item.sourceId ?? "")}`
                )} />
                <ListBlock title="누락 필드" items={asStringArray(revalidation.missingFields)} />
                <ListBlock title="리스크 플래그" items={asStringArray(revalidation.riskFlags)} />
              </div>
              <DuplicateBlock value={revalidation.duplicateCheck} />
            </>
          ) : (
            <p className="text-muted-foreground">
              AI 재검증이 아직 실행되지 않았습니다. 프로젝트성 후보를 승인하기 전에 AI 검증을
              실행하세요.
            </p>
          )}
        </CardContent>
	      </Card>

	      <Card>
	        <CardHeader>
	          <CardTitle>정책 판정 로그</CardTitle>
	        </CardHeader>
	        <CardContent className="space-y-2 text-sm">
	          {decisionLogs.length === 0 ? (
	            <p className="text-muted-foreground">아직 기록된 정책 판정 로그가 없습니다.</p>
	          ) : (
	            decisionLogs.map((log) => (
	              <div key={log.id} className="rounded-md border px-3 py-2">
	                <p className="font-medium">{log.decisionType}</p>
	                <p className="text-xs text-muted-foreground">{formatDate(log.createdAt)}</p>
	                <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">
	                  {JSON.stringify(log.outputJson ?? {}, null, 2)}
	                </pre>
	              </div>
	            ))
	          )}
	        </CardContent>
	      </Card>

	      <Card>
        <CardHeader>
          <CardTitle>메일 원문</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {sourceDocument ? (
            <>
              <div className="flex flex-wrap gap-2">
                {sourceDocument.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-xs">
                {sourceDocument.body}
              </pre>
            </>
          ) : (
            <p className="text-muted-foreground">원문 문서를 찾을 수 없습니다.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>후보 메타데이터</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          {metadataEntries(candidate.metadata).map((entry) => (
            <Info key={entry.key} label={entry.key} value={entry.value || "—"} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-words font-medium">{value}</p>
    </div>
  );
}

function ListBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="min-w-0 rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">없음</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((item, index) => (
            <li key={`${title}-${index}`} className="break-words">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DuplicateBlock({ value }: { value: unknown }) {
  const duplicate = metadataRecord(value);
  const possible = duplicate.possibleDuplicate === true;
  return (
    <div className="min-w-0 rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">중복 확인</p>
      <p className="break-words text-sm">
        {possible ? "중복 가능성 있음" : "중복 없음"}
        {duplicate.reason ? ` — ${String(duplicate.reason)}` : ""}
      </p>
    </div>
  );
}

function entityHref(entityType?: string | null) {
  if (entityType === "customer") return "/customers";
  if (entityType === "partner") return "/partners";
  if (entityType === "task") return "/tasks";
  if (entityType === "opportunity") return "/opportunities";
  if (entityType === "poc") return "/poc";
  return "/approvals";
}
