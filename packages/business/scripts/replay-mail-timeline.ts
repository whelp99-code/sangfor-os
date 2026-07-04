/**
 * replay-mail-timeline.ts — Mail classification timeline replay pilot
 *
 * Reads historical mail from the DB in strict chronological order, runs
 * the classification workflow on each inbound message, and writes a JSON
 * artifact for human review.
 *
 * Note: the MailMessage model has no full `body` column — only the already-
 * preview-length `bodyPreview` (nullable String). Wherever the classification
 * functions expect a raw email body (e.g. `parseMailHeader`), `bodyPreview`
 * is substituted. This is a known limitation: header-parsing heuristics will
 * find few or no header lines in preview text, so domain-based filtering in
 * `classifyMailCandidateDocument` will largely fall through. The keyword-
 * matching and summarisation paths are unaffected.
 *
 * Usage:
 *   npx tsx packages/business/scripts/replay-mail-timeline.ts [options]
 *
 * Options:
 *   --limit N          Max mails to process (default: 15)
 *   --from YYYY-MM-DD  Earliest receivedAt (inclusive)
 *   --to YYYY-MM-DD    Latest receivedAt (inclusive)
 *   --out <path>       Output path (default: .agents/results/replay/pilot.json)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ── Type-only imports (erased at runtime — safe before env setup) ──────────
import type { AiClassificationResult, ThreadLike } from '../src/mail/classify-rules';

// ── Force local 9router LLM endpoint BEFORE any project import ─────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const envPath = path.resolve(__dirname, '../../../.env');
try {
  const envContent = fs.readFileSync(envPath, 'utf8');
  // Match OPENAI_API_KEY="value", OPENAI_API_KEY='value', or OPENAI_API_KEY=value
  const keyRe = /^OPENAI_API_KEY=(?:"([^"]*)"|'([^']*)'|(\S+))/gm;
  let m: RegExpExecArray | null;
  let lastKey: string | undefined;
  while ((m = keyRe.exec(envContent)) !== null) {
    lastKey = m[1] ?? m[2] ?? m[3];
  }
  // The LAST occurrence in .env is the local 9router key
  if (lastKey) {
    process.env.OPENAI_API_KEY = lastKey;
  } else {
    console.warn('Warning: no OPENAI_API_KEY found in .env — falling back to process.env');
  }
} catch (err) {
  console.warn(`Warning: could not read .env at ${envPath}: ${err}`);
}

process.env.OPENAI_BASE_URL = 'http://127.0.0.1:20128/v1';
process.env.OPENAI_MODEL = 'cx/gpt-5.4-mini';
process.env.OPENAI_REVIEW_MODEL = 'cx/gpt-5.4-mini-review';

// ── CLI argument parsing ────────────────────────────────────────────────────

interface CliOptions {
  limit: number;
  from?: string;
  to?: string;
  out: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {
    limit: 15,
    out: path.resolve(process.cwd(), '.agents/results/replay/pilot.json'),
  };
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        opts.limit = parseInt(args[++i]!, 10);
        break;
      case '--from':
        opts.from = args[++i];
        break;
      case '--to':
        opts.to = args[++i];
        break;
      case '--out':
        opts.out = path.resolve(process.cwd(), args[++i]);
        break;
    }
  }
  return opts;
}

function parseDomain(email: string | null | undefined): string {
  if (!email) return '';
  const atIdx = email.lastIndexOf('@');
  return atIdx >= 0 ? email.slice(atIdx + 1).toLowerCase() : '';
}

// ── Event types ────────────────────────────────────────────────────────────

interface ReplayEvent {
  seq: number;
  receivedAt: string | null;
  direction: string | null;
  from: string | null;
  subject: string;
  bodyPreview: string;
  /** True for outbound mail — the real decision/ground truth */
  groundTruth?: true;
  /** For outbound mail: the actual reply as it was sent */
  actualReply?: { subject: string; bodyPreview: string };
  /** Output of classifyMailCandidateDocument, or { error: string } on failure */
  ruleClassification?: unknown;
  /** Output of classifyMailInsightThreadHybrid, or { error: string } on failure */
  aiClassification?: unknown;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  // Dynamic imports — run AFTER env is set so openai-config.ts reads the
  // correct process.env.OPENAI_* values lazily at call time.
  const { prisma } = await import('@sangfor/db');
  const { classifyMailCandidateDocument } = await import('../src/mail/classify-rules');
  const { classifyMailInsightThreadHybrid } = await import('../src/mail/classify-ai');

  // ── Build DB filter ───────────────────────────────────────────────────
  const where: { receivedAt?: { gte?: Date; lte?: Date } } = {};
  if (opts.from) {
    where.receivedAt = { gte: new Date(opts.from) };
  }
  if (opts.to) {
    where.receivedAt = {
      ...(where.receivedAt ?? {}),
      lte: new Date(opts.to + 'T23:59:59.999Z'),
    };
  }

  // ── Query mail in strict chronological order ──────────────────────────
  const mails = await prisma.mailMessage.findMany({
    where,
    orderBy: [{ receivedAt: { sort: 'asc', nulls: 'last' } }],
    take: opts.limit,
    select: {
      id: true,
      receivedAt: true,
      direction: true,
      fromEmail: true,
      toEmail: true,
      subject: true,
      bodyPreview: true,
      conversationId: true,
    },
  });

  console.log(`Processing ${mails.length} mail(s) chronologically…\n`);

  const events: ReplayEvent[] = [];
  let inboundCount = 0;
  let outboundCount = 0;
  let errorCount = 0;

  for (let idx = 0; idx < mails.length; idx++) {
    const mail = mails[idx]!;
    const seq = idx + 1;
    const subject = mail.subject ?? '';
    const bodyText = mail.bodyPreview ?? '';
    const bodyTrunc = bodyText.slice(0, 500);

    // Progress line: [seq] YYYY-MM-DD <in|out> subject (~60 chars)
    const dateStr = mail.receivedAt
      ? mail.receivedAt.toISOString().slice(0, 10)
      : '????????';
    const dirStr =
      mail.direction === 'inbound'
        ? 'in '
        : mail.direction === 'outbound'
          ? 'out'
          : '?? ';
    const subjTrunc = subject.slice(0, 60);
    console.log(`[${String(seq).padStart(3, '0')}] ${dateStr} ${dirStr} ${subjTrunc}`);

    const event: ReplayEvent = {
      seq,
      receivedAt: mail.receivedAt?.toISOString() ?? null,
      direction: mail.direction,
      from: mail.fromEmail,
      subject,
      bodyPreview: bodyTrunc,
    };

    if (mail.direction === 'outbound') {
      // Outbound mail IS the ground truth — our actual sent reply
      event.groundTruth = true;
      event.actualReply = { subject, bodyPreview: bodyTrunc };
      outboundCount++;
    } else {
      // Inbound (or null/unknown direction — treat as inbound for classification)
      inboundCount++;

      // 1) Document-level rule classification (synchronous, no LLM)
      try {
        event.ruleClassification = classifyMailCandidateDocument({
          title: subject,
          body: bodyText,
          tags: [],
        });
      } catch (err) {
        event.ruleClassification = { error: String(err) };
        errorCount++;
      }

      // 2) Thread-level hybrid classification (rule + AI; may call LLM)
      try {
        const domain = parseDomain(mail.fromEmail);
        const thread: ThreadLike = {
          threadKey: mail.conversationId ?? mail.id,
          threadTitle: subject,
          summary: bodyText,
          status: 'open',
          aiEnhanced: false,
          revenueOpsTags: [],
          participantDomains: domain ? [domain] : [],
          metadata: {
            messages: [
              { from: mail.fromEmail, isPromotional: false },
            ],
          },
        };
        event.aiClassification = await classifyMailInsightThreadHybrid(thread);
      } catch (err) {
        event.aiClassification = { error: String(err) };
        errorCount++;
      }
    }

    events.push(event);
  }

  // ── Write output JSON ─────────────────────────────────────────────────
  const outDir = path.dirname(opts.out);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(opts.out, JSON.stringify(events, null, 2), 'utf8');

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('');
  console.log('─'.repeat(50));
  console.log(`Inbound processed:         ${inboundCount}`);
  console.log(`Outbound (ground truth):   ${outboundCount}`);
  console.log(`Classification errors:     ${errorCount}`);
  console.log(`Output:                    ${opts.out}`);
  console.log('─'.repeat(50));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
