import { Prisma, prisma } from "@sangfor/db";
import { recordDomainDecision, upsertDomainMemory } from "./domain-memory";
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
 * (caseRef='eng:'+id, decisionType='human_review'),
 * AND feeds learning: on 'approved' or 'corrected', upsertDomainMemory
 * so the domain learns the human-confirmed/edited output.
 */
export async function recordHumanDecision(
  input: RecordDecisionInput,
): Promise<{ decisionId: string }> {
  const { engagementId, domain, outcome, output, humanEdit, note } = input;
  const caseRef = "eng:" + engagementId;

  const decision = await recordDomainDecision({
    domain,
    caseRef,
    decisionType: "human_review",
    outputJson: output !== undefined ? (output as Prisma.InputJsonValue) : undefined,
    humanEditJson: humanEdit !== undefined ? (humanEdit as Prisma.InputJsonValue) : undefined,
    outcome,
  });

  // Feed domain learning on approved or corrected
  if (outcome === "approved" || outcome === "corrected") {
    const memoryKey = caseRef + ":" + domain;
    await upsertDomainMemory({
      domain,
      memoryType: "case",
      key: memoryKey,
      label: note ?? (outcome === "approved" ? "human approved" : "human corrected"),
      valueJson: (humanEdit !== undefined ? humanEdit : output) as Prisma.InputJsonValue,
      outcome,
      source: "human",
      confidence: outcome === "approved" ? 90 : 85,
    });
  }

  return { decisionId: decision.id };
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
