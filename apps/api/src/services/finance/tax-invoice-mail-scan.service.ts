import { prisma } from '@sangfor/db';
import { ingestSecureMailHtml } from './tax-invoice-inbound.service';

const NTS_SENDER = 'hometax.go.kr';

export function isHometaxMail(msg: { fromEmail: string; subject: string }): boolean {
  return (msg.fromEmail || '').toLowerCase().includes(NTS_SENDER);
}

// fetchAttachmentHtml is injected so this service is testable without Microsoft Graph.
export async function scanAndIngestHometaxMails(
  accountId: string,
  fetchAttachmentHtml: (externalId: string) => Promise<string | null>,
): Promise<{ scanned: number; created: number; duplicate: number; failed: number }> {
  const stats = { scanned: 0, created: 0, duplicate: 0, failed: 0 };

  const messages = await prisma.mailMessage.findMany({
    where: { accountId, fromEmail: { contains: NTS_SENDER, mode: 'insensitive' } },
  });

  for (const m of messages) {
    if (!m.externalId) continue;
    stats.scanned++;
    try {
      const html = await fetchAttachmentHtml(m.externalId);
      if (!html) {
        stats.failed++;
        continue;
      }
      const r = await ingestSecureMailHtml(html, m.id);
      if (r.status === 'created') stats.created++;
      else if (r.status === 'duplicate') stats.duplicate++;
      else if (r.status === 'failed') stats.failed++;
      // 'skipped_not_ours' is neither created/duplicate/failed — not counted
    } catch {
      stats.failed++; // one bad mail must not abort the batch
    }
  }

  return stats;
}
