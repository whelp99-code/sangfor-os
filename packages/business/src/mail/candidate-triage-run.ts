import { prisma } from "@sangfor/db";

import {
  buildTriagePlan,
  learnDispositionRules,
  titleKey,
  type CandidateType,
  type DecidedCandidate,
  type DecidedStatus,
  type DispositionRules,
  type TriageDecision,
  type TriageRule,
} from "./candidate-triage";

export interface TriageReport {
  readonly batchId: string;
  readonly dryRun: boolean;
  readonly rules: DispositionRules;
  readonly historySize: number;
  readonly pendingBefore: number;
  readonly automated: number;
  readonly humanReviewRemaining: number;
  readonly byRule: Readonly<Record<string, number>>;
  readonly applied: number;
}

const DECIDED: readonly DecidedStatus[] = ["converted", "rejected", "knowledge_only"];

/**
 * Learn from the decisions humans already made, then file the pending backlog
 * that those decisions render unambiguous. Automated dispositions only ever set
 * `knowledge_only`, and each row records the batch and its previous status so an
 * operator can reverse the whole batch.
 */
export async function triageProposedCandidates(options: { dryRun?: boolean } = {}): Promise<TriageReport> {
  const dryRun = options.dryRun ?? true;
  const batchId = `triage-${new Date().toISOString().replace(/[:.]/gu, "")}`;

  const decided = await prisma.mailDerivedCandidate.findMany({
    where: { status: { in: [...DECIDED] } },
    select: { candidateType: true, confidence: true, status: true, title: true },
  });
  const history: DecidedCandidate[] = decided.map((row) => ({
    candidateType: row.candidateType as CandidateType,
    confidence: row.confidence,
    status: row.status as DecidedStatus,
    title: row.title,
  }));

  const rules = learnDispositionRules(history);

  const convertedTitles = new Set(
    decided
      .filter((row) => row.status === "converted")
      .map((row) => titleKey(row.candidateType, row.title)),
  );

  const policies = await prisma.policyMemory.findMany({
    where: { status: "active" },
    select: { key: true },
  });

  const pendingRows = await prisma.mailDerivedCandidate.findMany({
    where: { status: "proposed" },
    select: { id: true, candidateType: true, confidence: true, title: true, metadata: true },
    orderBy: [{ confidence: "desc" }, { createdAt: "asc" }],
  });

  const plan = buildTriagePlan({
    pending: pendingRows.map((row) => ({
      id: row.id,
      candidateType: row.candidateType as CandidateType,
      confidence: row.confidence,
      title: row.title,
    })),
    rules,
    convertedTitles,
    knownPolicyKeys: policies.map((p) => p.key),
  });

  const byRule: Record<string, number> = {};
  for (const decision of plan.decisions) {
    byRule[decision.rule] = (byRule[decision.rule] ?? 0) + 1;
  }

  let applied = 0;
  if (!dryRun && plan.decisions.length > 0) {
    const metadataById = new Map(pendingRows.map((row) => [row.id, row.metadata]));
    for (const decision of plan.decisions) {
      const previous = metadataById.get(decision.id);
      const base = previous && typeof previous === "object" && !Array.isArray(previous) ? previous : {};
      await prisma.mailDerivedCandidate.update({
        where: { id: decision.id },
        data: {
          status: decision.nextStatus,
          metadata: {
            ...(base as Record<string, unknown>),
            autoTriage: {
              batchId,
              rule: decision.rule satisfies TriageRule,
              evidence: decision.evidence,
              previousStatus: "proposed",
              decidedAt: new Date().toISOString(),
            },
          },
        },
      });
      applied += 1;
    }
  }

  return {
    batchId,
    dryRun,
    rules,
    historySize: history.length,
    pendingBefore: pendingRows.length,
    automated: plan.decisions.length,
    humanReviewRemaining: plan.humanReview.length,
    byRule,
    applied,
  };
}

/** Reverse one automated batch, restoring every row it touched to `proposed`. */
export async function revertTriageBatch(batchId: string): Promise<number> {
  const rows = await prisma.mailDerivedCandidate.findMany({
    where: { status: "knowledge_only" },
    select: { id: true, metadata: true },
  });
  let reverted = 0;
  for (const row of rows) {
    const meta = row.metadata as { autoTriage?: { batchId?: string } } | null;
    if (meta?.autoTriage?.batchId !== batchId) continue;
    await prisma.mailDerivedCandidate.update({
      where: { id: row.id },
      data: { status: "proposed" },
    });
    reverted += 1;
  }
  return reverted;
}

export type { TriageDecision };
