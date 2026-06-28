/**
 * Promote meeting-like mail threads into MeetingNote rows (미팅내용 흡수 소스).
 *
 * A thread is associated to an opportunity through the converted MailDerivedCandidate
 * that points at it (candidate.mailInsightThreadId → thread, candidate.createdEntityId
 * → opportunity). Threads whose title/summary look like a meeting are upserted as
 * `source="mail"`, `status="suggested"` MeetingNotes for human review.
 *
 * Idempotent: the @@unique([opportunityId, mailInsightThreadId]) makes re-runs a no-op.
 * Runs OUTSIDE the conversion transaction (post-commit step).
 */
import { prisma } from "@sangfor/db";

const MEETING_KEYWORDS = [
  "미팅",
  "회의",
  "회의록",
  "미팅록",
  "mom",
  "minutes",
  "meeting",
  "kickoff",
  "kick-off",
  "킥오프",
  "콜",
  "통화",
  "화상",
  "zoom",
  "teams",
  "google meet",
];

function looksLikeMeeting(text: string): boolean {
  const lower = text.toLowerCase();
  return MEETING_KEYWORDS.some((k) => lower.includes(k));
}

export async function promoteMeetingThreads(
  opts: { opportunityId?: string } = {},
): Promise<{ scanned: number; promoted: number }> {
  const candidates = await prisma.mailDerivedCandidate.findMany({
    where: {
      candidateType: "opportunity",
      status: "converted",
      createdEntityType: "opportunity",
      mailInsightThreadId: { not: null },
      ...(opts.opportunityId ? { createdEntityId: opts.opportunityId } : { createdEntityId: { not: null } }),
    },
    select: { mailInsightThreadId: true, createdEntityId: true },
  });

  let scanned = 0;
  let promoted = 0;
  for (const candidate of candidates) {
    if (!candidate.mailInsightThreadId || !candidate.createdEntityId) continue;
    const thread = await prisma.mailInsightThread.findUnique({ where: { id: candidate.mailInsightThreadId } });
    if (!thread) continue;
    scanned++;
    if (!looksLikeMeeting(`${thread.threadTitle} ${thread.summary}`)) continue;

    await prisma.meetingNote.upsert({
      where: {
        opportunityId_mailInsightThreadId: {
          opportunityId: candidate.createdEntityId,
          mailInsightThreadId: thread.id,
        },
      },
      update: {},
      create: {
        opportunityId: candidate.createdEntityId,
        mailInsightThreadId: thread.id,
        title: thread.threadTitle.slice(0, 200),
        bodyMarkdown: thread.summary,
        source: "mail",
        status: "suggested",
      },
    });
    promoted++;
  }

  return { scanned, promoted };
}
