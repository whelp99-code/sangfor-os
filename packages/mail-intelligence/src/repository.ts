import { prisma } from "@ai-portal/db";

import type { MailGroup, MailMessageMeta, MailSyncResult, TaskCandidate } from "./contract";

/**
 * Read-only mail repository for portal rehearsal.
 * Send/delete/move are intentionally not implemented.
 */
export async function listMailMessages(limit = 20): Promise<MailMessageMeta[]> {
  const rows = await prisma.mailMessage.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((m) => ({
    id: m.id,
    subject: m.subject,
    fromAddress: m.fromEmail,
    receivedAt: m.createdAt.toISOString(),
    groupKey: m.groupKey ?? undefined,
    preview: m.bodyPreview ?? undefined,
  }));
}

export async function getMailOverview(): Promise<MailSyncResult> {
  const [accounts, messages, rows] = await Promise.all([
    prisma.mailAccount.count(),
    prisma.mailMessage.count(),
    prisma.mailMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  const groupMap = new Map<string, number>();
  for (const row of rows) {
    const key = row.groupKey ?? "general";
    groupMap.set(key, (groupMap.get(key) ?? 0) + 1);
  }

  const groups: MailGroup[] = [...groupMap.entries()].map(([key, messageCount]) => ({
    key,
    label: key,
    messageCount,
  }));

  const taskCandidates: TaskCandidate[] = rows.slice(0, 5).map((m) => ({
    mailMessageId: m.id,
    title: `Follow up: ${m.subject}`,
    summary: m.bodyPreview ?? m.subject,
    priority: "normal",
  }));

  return { accounts, messages, groups, taskCandidates };
}
