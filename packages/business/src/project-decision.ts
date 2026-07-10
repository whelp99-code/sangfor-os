import { Prisma, prisma } from "@sangfor/db";
import { buildMemoryTags, recordDomainDecision, upsertDomainMemory } from "./domain-ai/domain-memory";
import { promoteDomainProposalToDocument } from "./domain-ai/proposal-promote";
import type { DomainKey } from "./artifact-domain-map";

export type { DomainKey };

export interface RecordDecisionInput {
  engagementId: string;
  domain: DomainKey;
  outcome: "approved" | "corrected" | "rejected";
  output?: unknown; // the AI proposal being decided on
  humanEdit?: unknown; // the human's correction (present when outcome='corrected')
  note?: string;
}

/**
 * Records a human review decision tied to the engagement
 * (caseRef='eng:'+id, decisionType='human_review') and closes the AI-proposal
 * loop:
 *  1. finds the pending ai_proposal being decided on (so the real generated
 *     content — not just a note — drives learning + promotion). Falls back to
 *     the caller-supplied `output` when no pending row exists.
 *  2. on approved/corrected: upsertDomainMemory (human-source) so the domain
 *     learns, AND promotes the artifact into the unified GeneratedDocument store.
 *  3. marks the pending ai_proposal resolved so it leaves the review queue.
 */
export async function recordHumanDecision(
  input: RecordDecisionInput,
): Promise<{ decisionId: string; documentId?: string }> {
  const { engagementId, domain, outcome, output, humanEdit, note } = input;
  const caseRef = "eng:" + engagementId;

  // 1. The pending AI proposal being decided on — real content for learning/promotion.
  const pending = await prisma.domainDecisionLog.findFirst({
    where: { caseRef, domain, decisionType: "ai_proposal", outcome: null },
    orderBy: { createdAt: "desc" },
  });
  const proposalOutput =
    output !== undefined ? output : (pending?.outputJson as unknown);

  const decision = await recordDomainDecision({
    domain,
    caseRef,
    decisionType: "human_review",
    actor: "human",
    outputJson:
      proposalOutput !== undefined && proposalOutput !== null
        ? (proposalOutput as Prisma.InputJsonValue)
        : undefined,
    humanEditJson: humanEdit !== undefined ? (humanEdit as Prisma.InputJsonValue) : undefined,
    outcome,
  });

  // 2. Resolve the pending proposal so it leaves the queue (getPendingProposals filters outcome:null).
  if (pending) {
    await prisma.domainDecisionLog.update({
      where: { id: pending.id },
      data: { outcome, resolvedAt: new Date(), resolvedBy: "human" },
    });
  }

  let documentId: string | undefined;

  // 3. Feed domain learning + promote on approved or corrected.
  if (outcome === "approved" || outcome === "corrected") {
    const memoryKey = caseRef + ":" + domain;
    await upsertDomainMemory({
      domain,
      memoryType: "case",
      key: memoryKey,
      label: note ?? (outcome === "approved" ? "human approved" : "human corrected"),
      // Use shared tag vocabulary so recall queries can find these memories.
      tags: buildMemoryTags({ domain, entityType: "proposal", intentTag: outcome }),
      valueJson: (humanEdit !== undefined ? humanEdit : proposalOutput) as Prisma.InputJsonValue,
      outcome,
      source: "human",
      confidence: outcome === "approved" ? 90 : 85,
    });

    // Promote to the unified document store (best-effort; skips when the
    // engagement→project chain or proposal content is missing).
    const proposal = proposalOutput as { title?: string; bodyMarkdown?: string } | null | undefined;
    if (proposal?.title && proposal?.bodyMarkdown) {
      try {
        const promoted = await promoteDomainProposalToDocument({
          engagementId,
          domain,
          title: proposal.title,
          bodyMarkdown: proposal.bodyMarkdown,
          status: outcome === "approved" ? "approved" : "draft",
        });
        documentId = promoted?.documentId;
      } catch {
        // promotion is non-blocking — the decision + learning still stand
      }
    }
  }

  return { decisionId: decision.id, documentId };
}

export interface AutonomyInput {
  outcome: string;
  hasHumanEdit: boolean;
}

export interface Autonomy {
  pct: number | null;
  sample: number;
  label: string;
}

export const MIN_AUTONOMY_SAMPLE = 3;

/**
 * Pure function: computes autonomy over HUMAN-REVIEWED decisions.
 * approved & !hasHumanEdit => autonomous; corrected/rejected or hasHumanEdit => not.
 * pct = round(autonomousCount / sample * 100).
 * sample < MIN_AUTONOMY_SAMPLE => {pct:null, sample, label:'학습중'}
 * else {pct, sample, label: pct>=85?'높음':pct>=50?'보통':'낮음'}
 */
export function computeAutonomy(decisions: AutonomyInput[]): Autonomy {
  const sample = decisions.length;
  if (sample < MIN_AUTONOMY_SAMPLE) {
    return { pct: null, sample, label: "학습중" };
  }

  const autonomousCount = decisions.filter(
    (d) => d.outcome === "approved" && !d.hasHumanEdit,
  ).length;

  const pct = Math.round((autonomousCount / sample) * 100);
  const label = pct >= 85 ? "높음" : pct >= 50 ? "보통" : "낮음";
  return { pct, sample, label };
}

/**
 * Reads DomainDecisionLog rows for a domain that are human_review
 * (across the project — autonomy is cross-engagement per domain),
 * maps to AutonomyInput, returns computeAutonomy result.
 */
export async function getDomainAutonomy(
  domain: DomainKey,
  projectSlug?: string,
): Promise<Autonomy> {
  // If projectSlug provided, resolve to projectId for scoping
  let whereClause: Record<string, unknown> = { domain, decisionType: "human_review" };

  if (projectSlug) {
    const project = await prisma.project.findUnique({ where: { slug: projectSlug } });
    if (project) {
      whereClause = { domain, decisionType: "human_review", projectId: project.id };
    }
  }

  const rows = await prisma.domainDecisionLog.findMany({ where: whereClause });

  const decisions: AutonomyInput[] = rows.map((row) => ({
    outcome: row.outcome ?? "",
    // Treat null (DB null) or Prisma.JsonNull sentinel as no edit.
    // Prisma returns DB NULL as null; the Prisma.JsonNull object is only used
    // as an input sentinel (write side), so at runtime we only see null here.
    hasHumanEdit: row.humanEditJson !== null && row.humanEditJson !== undefined,
  }));

  return computeAutonomy(decisions);
}
