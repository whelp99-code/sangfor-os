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
