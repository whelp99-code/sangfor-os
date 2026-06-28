/**
 * Turn synced Outlook messages into learned business signals.
 *
 * Sent + received messages that share a `conversationId` are grouped into one
 * thread, upserted as a MailInsightThread (which also builds a KnowledgeDocument
 * for RAG), then classified into MailDerivedCandidates (customer / partner /
 * opportunity / poc / task) by the existing learning pipeline.
 */
import { prisma } from "@sangfor/db";
import { generateMailDerivedCandidates, upsertMailInsightThreads } from "@sangfor/business";
import { sanitizeText } from "./outlook-graph";

const PROJECT_SLUG = "demo-project";
const UPSERT_BATCH = 50;

function domainOf(email?: string | null): string | null {
  if (!email || !email.includes("@")) return null;
  return email.split("@")[1].toLowerCase();
}

type MailRow = Awaited<ReturnType<typeof prisma.mailMessage.findMany>>[number];

export async function learnFromMailbox(): Promise<{
  threads: number;
  candidates: unknown;
}> {
  const account = await prisma.mailAccount.findFirst({ where: { provider: "outlook" } });
  const messages = await prisma.mailMessage.findMany({
    where: { conversationId: { not: null } },
  });

  // Group sent + received together by conversation.
  const groups = new Map<string, MailRow[]>();
  for (const m of messages) {
    const key = m.conversationId as string;
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }

  const threads = [...groups.entries()].map(([conversationId, msgs]) => {
    const sorted = [...msgs].sort(
      (a, b) => (a.receivedAt?.getTime() ?? 0) - (b.receivedAt?.getTime() ?? 0),
    );
    const latest = sorted[sorted.length - 1];
    const inbound = msgs.filter((m) => m.direction === "outbound" ? false : true).length;
    const outbound = msgs.filter((m) => m.direction === "outbound").length;
    const domains = Array.from(
      new Set(
        msgs
          .flatMap((m) => [domainOf(m.fromEmail), domainOf(m.toEmail)])
          .filter((d): d is string => Boolean(d)),
      ),
    );
    const lines = sorted
      .slice(-6)
      .map(
        (m) =>
          `[${m.direction === "outbound" ? "보낸" : "받은"}] ${m.fromEmail}` +
          `${m.toEmail ? ` → ${m.toEmail}` : ""}: ${(m.subject || "").slice(0, 120)}`,
      );
    const summary = sanitizeText(
      `대화 ${msgs.length}건 (받은 ${inbound} / 보낸 ${outbound}).\n` +
        lines.join("\n") +
        (latest.bodyPreview ? `\n\n최근 내용: ${latest.bodyPreview}` : ""),
    );

    return {
      threadKey: conversationId,
      threadTitle: sanitizeText((latest.subject || "(no subject)").slice(0, 200)) || "(no subject)",
      accountId: account?.id,
      accountEmail: account?.email,
      messageCount: msgs.length,
      messageIds: msgs.map((m) => m.id),
      latestReceivedAt: latest.receivedAt ? latest.receivedAt.toISOString() : undefined,
      summary,
      participantDomains: domains,
      metadata: { inbound, outbound },
    };
  });

  if (threads.length === 0) {
    return { threads: 0, candidates: { created: 0 } };
  }

  // Each thread also writes a knowledge doc + chunks, so batch the upserts.
  for (let i = 0; i < threads.length; i += UPSERT_BATCH) {
    await upsertMailInsightThreads({
      projectSlug: PROJECT_SLUG,
      threads: threads.slice(i, i + UPSERT_BATCH),
    });
  }

  const candidates = await generateMailDerivedCandidates({
    projectSlug: PROJECT_SLUG,
    limit: Math.min(2000, threads.length),
  });

  return { threads: threads.length, candidates };
}
