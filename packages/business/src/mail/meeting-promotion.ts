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

// Trust score = number of DISTINCT meeting keywords found (P7 #4). A higher score
// means stronger evidence the thread is an actual meeting.
function meetingScore(text: string): number {
  const lower = text.toLowerCase();
  return MEETING_KEYWORDS.filter((k) => lower.includes(k)).length;
}

// Default trust threshold: at/above this distinct-keyword count, a promoted meeting
// is auto-`confirmed` (so conversion absorbs it); below it stays `suggested` for
// human review and is NOT auto-attached. Override via opts.confirmThreshold.
const DEFAULT_CONFIRM_THRESHOLD = 2;

export async function promoteMeetingThreads(
  opts: { opportunityId?: string; confirmThreshold?: number } = {},
): Promise<{ scanned: number; promoted: number; confirmed: number; suggested: number }> {
  const confirmThreshold = opts.confirmThreshold ?? DEFAULT_CONFIRM_THRESHOLD;
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
  let confirmed = 0;
  let suggested = 0;
  for (const candidate of candidates) {
    if (!candidate.mailInsightThreadId || !candidate.createdEntityId) continue;
    const thread = await prisma.mailInsightThread.findUnique({ where: { id: candidate.mailInsightThreadId } });
    if (!thread) continue;
    scanned++;
    const score = meetingScore(`${thread.threadTitle} ${thread.summary}`);
    if (score === 0) continue;
    const status = score >= confirmThreshold ? "confirmed" : "suggested";

    await prisma.meetingNote.upsert({
      where: {
        opportunityId_mailInsightThreadId: {
          opportunityId: candidate.createdEntityId,
          mailInsightThreadId: thread.id,
        },
      },
      // Only raise trust (suggested → confirmed); never silently downgrade a human-confirmed note.
      update: status === "confirmed" ? { status: "confirmed" } : {},
      create: {
        opportunityId: candidate.createdEntityId,
        mailInsightThreadId: thread.id,
        title: thread.threadTitle.slice(0, 200),
        bodyMarkdown: thread.summary,
        source: "mail",
        status,
      },
    });
    promoted++;
    if (status === "confirmed") confirmed++;
    else suggested++;
  }

  return { scanned, promoted, confirmed, suggested };
}
