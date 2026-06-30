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

export type OpportunityStageOrderReason =
  | "stage_skip_forward"
  | "illegal_stage_regression"
  | "stage_is_terminal";

export type OpportunityStageOrderDecision =
  | { allowed: true }
  | { allowed: false; reason: OpportunityStageOrderReason };

/**
 * Linear pipeline used for ordering checks. WON/LOST are terminal outcomes and
 * are intentionally excluded so they get their own rules below.
 */
const ORDERED_PIPELINE: OpportunityStage[] = [
  "LEAD",
  "QUALIFIED",
  "PROPOSAL",
  "POC",
  "NEGOTIATION",
];

/**
 * Enforces canonical stage ordering for an opportunity stage change.
 *
 * Policy (deliberately permissive on backward moves, strict on forward skips):
 *  - Same stage → allowed (no-op).
 *  - LOST is reachable from any non-terminal stage (a deal can be lost anytime).
 *  - WON is reachable only by adjacent advance from NEGOTIATION.
 *  - Within the linear pipeline (LEAD…NEGOTIATION):
 *      • forward by exactly one step (adjacent advance) — allowed
 *      • any backward move (revert / correction) — allowed
 *      • forward skipping ≥2 stages — rejected (`stage_skip_forward`)
 *  - From a terminal stage (WON / LOST): only WON→LOST or LOST→WON (outcome
 *    correction) and same-stage are allowed; re-entering the active pipeline
 *    is rejected (`stage_is_terminal`).
 */
export function validateOpportunityStageOrder(
  from: string,
  to: string,
): OpportunityStageOrderDecision {
  const fromStage = normalizeOpportunityStage(from);
  const toStage = normalizeOpportunityStage(to);

  if (fromStage === toStage) return { allowed: true };

  // LOST is always an acceptable outcome from any non-terminal stage.
  if (toStage === "LOST" && fromStage !== "WON") return { allowed: true };

  const fromTerminal = fromStage === "WON" || fromStage === "LOST";
  if (fromTerminal) {
    // Only allow correcting one terminal outcome into the other.
    if (
      (fromStage === "WON" && toStage === "LOST") ||
      (fromStage === "LOST" && toStage === "WON")
    ) {
      return { allowed: true };
    }
    return { allowed: false, reason: "stage_is_terminal" };
  }

  // WON may only be entered by an adjacent advance from NEGOTIATION.
  if (toStage === "WON") {
    if (fromStage === "NEGOTIATION") return { allowed: true };
    return { allowed: false, reason: "stage_skip_forward" };
  }

  const fromIdx = ORDERED_PIPELINE.indexOf(fromStage);
  const toIdx = ORDERED_PIPELINE.indexOf(toStage);

  // Both stages are within the linear pipeline at this point.
  if (toIdx < fromIdx) return { allowed: true }; // backward revert/correction
  if (toIdx - fromIdx === 1) return { allowed: true }; // adjacent forward
  return { allowed: false, reason: "stage_skip_forward" };
}
