import { OpportunityStage } from "@prisma/client";

export const CANONICAL_STAGES: OpportunityStage[] = [
  "LEAD",
  "QUALIFIED",
  "PROPOSAL",
  "POC",
  "NEGOTIATION",
  "WON",
  "LOST",
];

const LEGACY_TO_CANONICAL: Record<string, OpportunityStage> = {
  discovery: "LEAD",
  qualification: "QUALIFIED",
  lead: "LEAD",
  qualified: "QUALIFIED",
  proposal: "PROPOSAL",
  poc: "POC",
  negotiation: "NEGOTIATION",
  won: "WON",
  lost: "LOST",
};

export function normalizeOpportunityStage(stage: string): OpportunityStage {
  const upper = stage.toUpperCase() as OpportunityStage;
  if (CANONICAL_STAGES.includes(upper)) return upper;
  const mapped = LEGACY_TO_CANONICAL[stage.toLowerCase()];
  if (mapped) return mapped;
  return "LEAD";
}

export function displayOpportunityStage(stage: string): string {
  return normalizeOpportunityStage(stage);
}

export function nextOpportunityStage(stage: string): OpportunityStage | null {
  const canonical = normalizeOpportunityStage(stage);
  const idx = CANONICAL_STAGES.indexOf(canonical);
  if (idx < 0 || idx >= CANONICAL_STAGES.length - 2) return null;
  return CANONICAL_STAGES[idx + 1]!;
}

export interface BantScores {
  budgetScore: number;
  authorityScore: number;
  needScore: number;
  timelineScore: number;
}

export function calculateBantScore(scores: BantScores): {
  weightedScore: number;
  passed: boolean;
} {
  const weightedScore =
    scores.budgetScore * 0.25 +
    scores.authorityScore * 0.25 +
    scores.needScore * 0.3 +
    scores.timelineScore * 0.2;
  return {
    weightedScore: Math.round(weightedScore * 100) / 100,
    passed: weightedScore >= 60,
  };
}

export const BANT_LABELS: Record<keyof BantScores, string> = {
  budgetScore: "Budget (예산) — 25%",
  authorityScore: "Authority (의사결정권) — 25%",
  needScore: "Need (필요성) — 30%",
  timelineScore: "Timeline (일정) — 20%",
};

export type OpportunityQualificationInput = {
  bantScore: number;
  hasBudget: boolean;
  hasAuthority: boolean;
  hasNeed: boolean;
  hasTimeline: boolean;
  hasDiscoveryNote: boolean;
  hasSolutionFit: boolean;
};

export type OpportunityQualificationStatus = "needs_discovery" | "qualified" | "requires_review";

export type OpportunityQualificationDecision = {
  status: OpportunityQualificationStatus;
  reasons: string[];
  nextStage: "discovery" | "qualified";
};

export type OpportunityStageTransitionInput = {
  from: string;
  to: string;
  qualificationStatus: OpportunityQualificationStatus;
};

export type OpportunityStageTransitionDecision =
  | { allowed: true }
  | { allowed: false; reason: "opportunity_must_be_qualified" };

export function evaluateOpportunityQualification(
  input: OpportunityQualificationInput,
): OpportunityQualificationDecision {
  const reasons: string[] = [];

  if (!input.hasBudget) reasons.push("missing_budget");
  if (!input.hasAuthority) reasons.push("missing_authority");
  if (!input.hasNeed) reasons.push("missing_need");
  if (!input.hasTimeline) reasons.push("missing_timeline");
  if (!input.hasDiscoveryNote) reasons.push("missing_discovery_note");
  if (!input.hasSolutionFit) reasons.push("missing_solution_fit");
  if (!Number.isFinite(input.bantScore) || input.bantScore < 70) reasons.push("low_bant_score");

  if (reasons.length === 0) {
    return { status: "qualified", reasons: [], nextStage: "qualified" };
  }

  const status = input.bantScore >= 70 && input.hasDiscoveryNote ? "requires_review" : "needs_discovery";
  return { status, reasons, nextStage: "discovery" };
}

export function canTransitionOpportunityStage(
  input: OpportunityStageTransitionInput,
): OpportunityStageTransitionDecision {
  const targetStage = input.to.toLowerCase();
  const requiresQualification = targetStage === "quote" || targetStage === "proposal";

  if (requiresQualification && input.qualificationStatus !== "qualified") {
    return { allowed: false, reason: "opportunity_must_be_qualified" };
  }

  return { allowed: true };
}
