/**
 * Replay document generation — drives clear deals through the full role-AI
 * document workflow so the presales AI actually produces GeneratedDocument
 * artifacts (proposals) grounded in real mail context.
 *
 * READ-ONLY by default (dry-run). Pass --apply to perform DB writes.
 *
 * Per deal chain (reuses existing, tested functions — no new DB logic):
 *   find/create Customer -> find/create Opportunity -> Engagement (force=true)
 *   -> generateDomainProposal('presales', contextNote from real mail)
 *   -> recordHumanDecision('approved')  // critic-as-human-proxy
 *   -> GeneratedDocument + DocumentVersion + DomainMemory learning.
 *
 * Idempotent: re-run reuses existing customer/opportunity/engagement.
 *
 * Usage:
 *   npx tsx packages/business/scripts/replay-generate-documents.ts           # dry-run
 *   npx tsx packages/business/scripts/replay-generate-documents.ts --apply   # writes
 */
import fs from 'fs';
import path from 'path';

// ── Force local 9router LLM endpoint BEFORE any project import ──────────────
const envPath = path.resolve(process.cwd(), '.env');
try {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const keyRe = /^OPENAI_API_KEY=(?:"([^"]*)"|'([^']*)'|(\S+))/gm;
  let m: RegExpExecArray | null;
  let lastKey: string | undefined;
  while ((m = keyRe.exec(envContent)) !== null) lastKey = m[1] ?? m[2] ?? m[3];
  if (lastKey) process.env.OPENAI_API_KEY = lastKey;
} catch {
  console.warn('Warning: could not read .env for 9router key — using process.env');
}
process.env.OPENAI_BASE_URL = 'http://127.0.0.1:20128/v1';
process.env.OPENAI_MODEL = 'cx/gpt-5.4-mini';
process.env.OPENAI_REVIEW_MODEL = 'cx/gpt-5.4-mini-review';

interface Deal {
  name: string;
  match: string; // substring to find the deal's real mail context (subject or fromEmail)
}

// Clear, unambiguous end-customer deals verified during the classification replay.
const DEFAULT_DEALS: Deal[] = [
  { name: '인카금융서비스', match: '인카금융서비스' },
  { name: '지에스이앤씨(GS E&C)', match: 'gsenc' },
  { name: '씨젠', match: '씨젠' },
];

const apply = process.argv.includes('--apply');

interface DealResult {
  deal: string;
  contextFound: boolean;
  contextSubject?: string;
  engagementId?: string;
  documentId?: string | null;
  colorGatePass?: boolean | null;
  proposalTitle?: string;
}

async function main(): Promise<void> {
  const { prisma } = await import('@sangfor/db');
  const { convertOpportunityToProject, generateDomainProposal, recordHumanDecision } =
    await import('@sangfor/business');

  const project = await prisma.project.findFirst({ select: { id: true, name: true } });
  if (!project) throw new Error('No project row in DB');

  console.log(
    `Mode: ${apply ? 'APPLY (DB writes)' : 'DRY-RUN (no writes)'} | project=${project.name} (${project.id})`,
  );
  console.log('─'.repeat(60));

  const report: DealResult[] = [];

  for (const deal of DEFAULT_DEALS) {
    // Real mail context: earliest inbound mail mentioning this deal.
    const mail = await prisma.mailMessage.findFirst({
      where: {
        direction: 'inbound',
        OR: [{ subject: { contains: deal.match } }, { fromEmail: { contains: deal.match } }],
      },
      orderBy: { receivedAt: 'asc' },
      select: { subject: true, bodyPreview: true, receivedAt: true },
    });
    const day = mail?.receivedAt ? mail.receivedAt.toISOString().slice(0, 10) : '';
    const contextNote = mail
      ? `[${day}] ${mail.subject ?? ''}\n${(mail.bodyPreview ?? '').slice(0, 400)}`
      : `${deal.name} — Sangfor 도입 검토`;

    if (!apply) {
      console.log(
        `DRY [${deal.name}] mail=${mail ? `"${(mail.subject ?? '').slice(0, 44)}"` : '(none found)'}`,
      );
      report.push({ deal: deal.name, contextFound: !!mail, contextSubject: mail?.subject ?? undefined });
      continue;
    }

    // 1. Customer (find-or-create)
    let customer = await prisma.customer.findFirst({ where: { name: deal.name } });
    if (!customer) {
      customer = await prisma.customer.create({ data: { projectId: project.id, name: deal.name } });
    }
    // 2. Opportunity (find-or-create)
    let opp = await prisma.opportunity.findFirst({
      where: { customerId: customer.id },
      orderBy: { createdAt: 'asc' },
    });
    if (!opp) {
      opp = await prisma.opportunity.create({
        data: {
          projectId: project.id,
          customerId: customer.id,
          title: `${deal.name} - Sangfor 도입`,
          stage: 'LEAD',
          probability: 10,
        },
      });
    }
    // 3. Engagement (find-or-create; force bypasses stage+POC gates for historical replay)
    let engagementId: string;
    const existingEng = await prisma.engagement.findUnique({
      where: { opportunityId: opp.id },
      select: { id: true },
    });
    if (existingEng) {
      engagementId = existingEng.id;
    } else {
      const conv = await convertOpportunityToProject({ opportunityId: opp.id, force: true });
      engagementId = conv.engagement.id;
    }
    // 4. Presales role-AI generates the proposal (grounded in real mail context)
    const proposal = await generateDomainProposal({
      engagementId,
      domain: 'presales',
      customerName: deal.name,
      contextNote,
    });
    // 5. Critic-as-human-proxy approves → promote to GeneratedDocument + learn
    const decision = await recordHumanDecision({ engagementId, domain: 'presales', outcome: 'approved' });

    console.log(
      `APPLY [${deal.name}] doc=${decision.documentId ?? 'none'} gate=${proposal.colorGate?.pass ?? 'n/a'} title="${(proposal.title ?? '').slice(0, 44)}"`,
    );
    report.push({
      deal: deal.name,
      contextFound: !!mail,
      contextSubject: mail?.subject ?? undefined,
      engagementId,
      documentId: decision.documentId ?? null,
      colorGatePass: proposal.colorGate?.pass ?? null,
      proposalTitle: proposal.title,
    });
  }

  const outDir = path.resolve(process.cwd(), '.agents/results/replay');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'generated-docs.json'), JSON.stringify(report, null, 2));
  console.log('─'.repeat(60));
  console.log(`Report → .agents/results/replay/generated-docs.json`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
