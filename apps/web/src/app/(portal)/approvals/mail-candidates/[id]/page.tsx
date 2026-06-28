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
  if (!value) return "unknown";
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
            Back to approvals
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
              confidence {candidate.confidence}
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
            <CardTitle>Approval summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p className="break-words text-muted-foreground">{candidate.summary}</p>
            <div className="grid gap-2 sm:grid-cols-2">
	              <Info label="Source title" value={candidate.sourceTitle ?? "mail"} />
	              <Info label="Sender" value={candidate.sourceSender ?? "unknown"} />
	              <Info label="Received" value={formatDate(candidate.sourceReceivedAt)} />
	              <Info label="Created entity" value={candidate.createdEntityId ?? "not created"} />
	              <Info label="Thread key" value={String(mailIntelligence.threadKey ?? candidate.mailInsightThread?.threadKey ?? "unknown")} />
	              <Info label="Mail Intel mode" value={mailIntelligence.aiEnhanced === true ? "AI enhanced" : "rules/cache"} />
	            </div>
	          </CardContent>
	        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Approval effect</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Approval creates one operational record of type{" "}
              <span className="font-medium text-foreground">{candidate.candidateType}</span>.
            </p>
            {["task", "opportunity", "poc"].includes(candidate.candidateType) ? (
              <p>
                Project-like candidates require AIOS AI revalidation before this approval can
                create an operational record.
              </p>
            ) : (
              <p>Customer and partner candidates are auto-derived, but still require final approval.</p>
            )}
            <p>Rejecting keeps this candidate as evidence and creates no operational record.</p>
            {candidate.createdEntityId ? (
              <Link
                href={entityHref(candidate.createdEntityType)}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                Open created record
              </Link>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Approve and connect to CRM / proposal</CardTitle>
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
	            <CardTitle>Mail Intelligence evidence</CardTitle>
	          </CardHeader>
	          <CardContent className="space-y-4 text-sm">
	            <p className="break-words text-muted-foreground">
	              {String(mailIntelligence.summary ?? candidate.mailInsightThread?.summary ?? candidate.summary)}
	            </p>
	            <div className="grid gap-3 lg:grid-cols-2">
	              <ListBlock
	                title="Evidence items"
	                items={asStringArray(mailIntelligence.evidenceItems ?? candidate.mailInsightThread?.evidenceItems)}
	              />
	              <ListBlock
	                title="Next actions"
	                items={asObjectArray(mailIntelligence.nextActions ?? candidate.mailInsightThread?.nextActions).map((item) =>
	                  String(item.recommendedAction ?? item.title ?? item.evidence ?? JSON.stringify(item))
	                )}
	              />
	            </div>
	          </CardContent>
	        </Card>

	        <Card>
	          <CardHeader>
	            <CardTitle>AIOS policy decision</CardTitle>
	          </CardHeader>
	          <CardContent className="space-y-4 text-sm">
	            <div className="grid gap-2 sm:grid-cols-2">
	              <Info label="Decision" value={String(policyDecision.decision ?? "unknown")} />
	              <Info label="Entity role" value={String(policyDecision.entityRole ?? "unknown")} />
	              <Info label="Reason" value={String(policyDecision.reason ?? "No policy reason recorded")} />
	              <Info label="Candidate name" value={String(policyDecision.candidateName ?? "unknown")} />
	            </div>
	            <ListBlock
	              title="Matched policy memories"
	              items={asObjectArray(policyDecision.matchedPolicyMemories).map((item) =>
	                `${String(item.memoryType ?? "memory")}: ${String(item.label ?? item.key ?? "")}`
	              )}
	            />
	          </CardContent>
	        </Card>
	      </div>

	      <Card>
	        <CardHeader>
          <CardTitle>AI revalidation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {revalidation ? (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <Info label="Decision" value={String(revalidation.decision ?? "unknown")} />
                <Info label="Mode" value={String(revalidation.mode ?? "unknown")} />
                <Info label="Confidence" value={String(revalidation.confidence ?? candidate.confidence)} />
              </div>
              <p className="break-words text-muted-foreground">
                {String(revalidation.reasoningSummary ?? "No reasoning summary.")}
              </p>
              <div className="grid gap-3 lg:grid-cols-3">
                <ListBlock title="Evidence" items={asObjectArray(revalidation.evidence).map((item) =>
                  `${String(item.sourceType ?? "source")}: ${String(item.quoteOrSummary ?? item.sourceId ?? "")}`
                )} />
                <ListBlock title="Missing fields" items={asStringArray(revalidation.missingFields)} />
                <ListBlock title="Risk flags" items={asStringArray(revalidation.riskFlags)} />
              </div>
              <DuplicateBlock value={revalidation.duplicateCheck} />
            </>
          ) : (
            <p className="text-muted-foreground">
              AI revalidation has not run yet. Run AI check before approving project-like
              candidates.
            </p>
          )}
        </CardContent>
	      </Card>

	      <Card>
	        <CardHeader>
	          <CardTitle>Policy decision log</CardTitle>
	        </CardHeader>
	        <CardContent className="space-y-2 text-sm">
	          {decisionLogs.length === 0 ? (
	            <p className="text-muted-foreground">No policy decision logs recorded yet.</p>
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
          <CardTitle>Mail source</CardTitle>
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
            <p className="text-muted-foreground">No source document found.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Candidate metadata</CardTitle>
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
        <p className="text-sm text-muted-foreground">None</p>
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
      <p className="text-xs text-muted-foreground">Duplicate check</p>
      <p className="break-words text-sm">
        {possible ? "Possible duplicate" : "No duplicate found"}
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
