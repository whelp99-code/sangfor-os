import { Prisma, prisma } from "@sangfor/db";
import { z } from "zod";

import { syncKnowledgeChunks } from "./knowledge-search";
import { resolveProjectId, seedDefaultMailPolicyMemory } from "./mail-policy-memory";

const jsonArraySchema = z.array(z.unknown()).default([]);

export const mailInsightThreadInputSchema = z.object({
  threadKey: z.string().min(1),
  threadTitle: z.string().min(1),
  sourceProvider: z.string().default("mail-intelligence"),
  accountId: z.string().optional(),
  accountEmail: z.string().optional(),
  messageCount: z.number().int().min(0).default(0),
  messageIds: z.array(z.string()).default([]),
  latestReceivedAt: z.string().datetime().optional(),
  status: z.string().default("reference"),
  effectiveStatus: z.string().optional(),
  aiEnhanced: z.boolean().default(false),
  summary: z.string().min(1),
  nextActions: jsonArraySchema,
  evidenceItems: jsonArraySchema,
  revenueOpsTags: z.array(z.string()).default([]),
  participantDomains: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
});

export const upsertMailInsightThreadsSchema = z.object({
  projectSlug: z.string().default("demo-project"),
  threads: z.array(mailInsightThreadInputSchema).min(1),
});

export const listMailInsightThreadsSchema = z.object({
  projectSlug: z.string().default("demo-project"),
  limit: z.number().int().min(1).max(2_000).default(100),
});

type MailInsightThreadInput = z.infer<typeof mailInsightThreadInputSchema>;

function compact(value: unknown, max = 500) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatJsonList(values: unknown[], field: string) {
  if (values.length === 0) return `${field}: none`;
  return values
    .slice(0, 12)
    .map((value, index) => {
      if (value && typeof value === "object") {
        return `${field} ${index + 1}: ${compact(JSON.stringify(value), 600)}`;
      }
      return `${field} ${index + 1}: ${compact(value, 600)}`;
    })
    .join("\n");
}

function buildKnowledgeBody(thread: MailInsightThreadInput) {
  const lines = [
    "Mail Intelligence Thread Insight",
    `ThreadKey: ${thread.threadKey}`,
    `ThreadTitle: ${thread.threadTitle}`,
    thread.accountEmail ? `Account: ${thread.accountEmail}` : "",
    `MessageCount: ${thread.messageCount || thread.messageIds.length}`,
    thread.latestReceivedAt ? `LatestReceivedAt: ${thread.latestReceivedAt}` : "",
    `Status: ${thread.status}`,
    thread.effectiveStatus ? `EffectiveStatus: ${thread.effectiveStatus}` : "",
    `AIEnhanced: ${thread.aiEnhanced ? "true" : "false"}`,
    thread.participantDomains.length ? `ParticipantDomains: ${thread.participantDomains.join(", ")}` : "",
    thread.revenueOpsTags.length ? `RevenueOpsTags: ${thread.revenueOpsTags.join(", ")}` : "",
    "",
    "Summary:",
    thread.summary,
    "",
    "Next actions:",
    formatJsonList(thread.nextActions, "Action"),
    "",
    "Evidence:",
    formatJsonList(thread.evidenceItems, "Evidence"),
    "",
    "MessageIds:",
    thread.messageIds.join(", ") || "none",
  ];
  return lines.filter((line) => line !== "").join("\n").slice(0, 50_000);
}

function hasVendorSupport(thread: MailInsightThreadInput): boolean {
  const checkEmail = (emailStr?: string | null) => {
    return String(emailStr ?? "").toLowerCase().includes("tech.support@sangfor.com");
  };
  if (checkEmail(thread.accountEmail)) return true;
  
  const metadata = thread.metadata && typeof thread.metadata === "object" ? thread.metadata as Record<string, unknown> : {};
  const messages = Array.isArray(metadata.messages) ? metadata.messages : [];
  for (const msg of messages) {
    const m = msg && typeof msg === "object" ? msg as Record<string, unknown> : {};
    if (checkEmail(String(m.from)) || checkEmail(String(m.fromName))) return true;
    const recipients = [
      ...Array.isArray(m.to) ? m.to : [],
      ...Array.isArray(m.cc) ? m.cc : [],
      ...Array.isArray(m.bcc) ? m.bcc : []
    ];
    for (const rec of recipients) {
      const addr = String(typeof rec === "string" ? rec : (rec as Record<string, unknown>).email ?? (rec as Record<string, unknown>).address ?? "");
      if (checkEmail(addr)) return true;
    }
  }
  return false;
}

function buildTags(thread: MailInsightThreadInput) {
  const isVendor = hasVendorSupport(thread);
  return uniqueStrings([
    "mail-intelligence",
    "mail-intelligence-thread",
    `thread-key:${thread.threadKey}`.slice(0, 160),
    `status:${thread.status}`,
    thread.aiEnhanced ? "mail-intel-ai" : "mail-intel-rules",
    ...(isVendor ? ["vendor-support", "sangfor-tech-support"] : []),
    ...thread.revenueOpsTags,
  ]).slice(0, 30);
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export async function listMailInsightThreads(
  input: z.input<typeof listMailInsightThreadsSchema> = {},
) {
  const parsed = listMailInsightThreadsSchema.parse(input);
  const projectId = await resolveProjectId(parsed.projectSlug);
  return prisma.mailInsightThread.findMany({
    where: { projectId },
    orderBy: [{ latestReceivedAt: "desc" }, { updatedAt: "desc" }],
    take: parsed.limit,
    include: {
      knowledgeDocument: { select: { id: true, title: true, source: true, tags: true } },
      _count: { select: { candidates: true } },
    },
  });
}

export async function upsertMailInsightThreads(
  input: z.input<typeof upsertMailInsightThreadsSchema>,
) {
  const parsed = upsertMailInsightThreadsSchema.parse(input);
  const { projectId } = await seedDefaultMailPolicyMemory(parsed.projectSlug);
  const stats = { upserted: 0, createdDocuments: 0, updatedDocuments: 0 };
  const threads = [];

  for (const thread of parsed.threads) {
    const existing = await prisma.mailInsightThread.findUnique({
      where: {
        projectId_threadKey: {
          projectId,
          threadKey: thread.threadKey,
        },
      },
    });
    const isVendor = hasVendorSupport(thread);
    const documentBody = buildKnowledgeBody(thread);
    const prefix = isVendor ? "[Vendor Support] " : "";
    const documentTitle = `${prefix}Mail Thread: ${thread.threadTitle}`.slice(0, 200);
    const documentTags = buildTags(thread);
    const source = isVendor ? "vendor-support" : "mail-intelligence-thread";

    const document = existing?.knowledgeDocumentId
      ? await prisma.knowledgeDocument.update({
          where: { id: existing.knowledgeDocumentId },
          data: {
            title: documentTitle,
            body: documentBody,
            tags: documentTags,
            source,
          },
        })
      : await prisma.knowledgeDocument.create({
          data: {
            projectId,
            title: documentTitle,
            body: documentBody,
            tags: documentTags,
            source,
          },
        });

    await syncKnowledgeChunks(document.id);
    if (existing?.knowledgeDocumentId) stats.updatedDocuments += 1;
    else stats.createdDocuments += 1;

    const upserted = await prisma.mailInsightThread.upsert({
      where: {
        projectId_threadKey: {
          projectId,
          threadKey: thread.threadKey,
        },
      },
      update: {
        threadTitle: thread.threadTitle,
        sourceProvider: thread.sourceProvider,
        accountId: thread.accountId,
        accountEmail: thread.accountEmail,
        messageCount: thread.messageCount || thread.messageIds.length,
        messageIds: thread.messageIds as Prisma.InputJsonValue,
        latestReceivedAt: parseDate(thread.latestReceivedAt),
        status: thread.status,
        effectiveStatus: thread.effectiveStatus,
        aiEnhanced: thread.aiEnhanced,
        summary: thread.summary,
        nextActions: thread.nextActions as Prisma.InputJsonValue,
        evidenceItems: thread.evidenceItems as Prisma.InputJsonValue,
        revenueOpsTags: uniqueStrings(thread.revenueOpsTags),
        participantDomains: uniqueStrings(thread.participantDomains),
        metadata: thread.metadata as Prisma.InputJsonValue,
        knowledgeDocumentId: document.id,
      },
      create: {
        projectId,
        threadKey: thread.threadKey,
        threadTitle: thread.threadTitle,
        sourceProvider: thread.sourceProvider,
        accountId: thread.accountId,
        accountEmail: thread.accountEmail,
        messageCount: thread.messageCount || thread.messageIds.length,
        messageIds: thread.messageIds as Prisma.InputJsonValue,
        latestReceivedAt: parseDate(thread.latestReceivedAt),
        status: thread.status,
        effectiveStatus: thread.effectiveStatus,
        aiEnhanced: thread.aiEnhanced,
        summary: thread.summary,
        nextActions: thread.nextActions as Prisma.InputJsonValue,
        evidenceItems: thread.evidenceItems as Prisma.InputJsonValue,
        revenueOpsTags: uniqueStrings(thread.revenueOpsTags),
        participantDomains: uniqueStrings(thread.participantDomains),
        metadata: thread.metadata as Prisma.InputJsonValue,
        knowledgeDocumentId: document.id,
      },
      include: {
        knowledgeDocument: { select: { id: true, title: true, source: true, tags: true } },
        _count: { select: { candidates: true } },
      },
    });

    // NOTE (ADR-001 deprecation boundary): writes `policy_decision_logs` as an
    // INGEST-AUDIT event (thread_ingested), not a governed human-in-loop decision,
    // so it is intentionally NOT routed through recordDecision(). Ingest audit is a
    // separate stream; stream-ownership is a named follow-up (PLAN §7).
    await prisma.policyDecisionLog.create({
      data: {
        projectId,
        entityType: "mail_insight_thread",
        entityId: upserted.id,
        decisionType: "thread_ingested",
        inputJson: {
          threadKey: thread.threadKey,
          messageIds: thread.messageIds,
        } as Prisma.InputJsonValue,
        outputJson: {
          knowledgeDocumentId: document.id,
          aiEnhanced: thread.aiEnhanced,
          status: thread.status,
        } as Prisma.InputJsonValue,
      },
    });

    stats.upserted += 1;
    threads.push(upserted);
  }

  return { ...stats, threads };
}
