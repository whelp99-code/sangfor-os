/** Roadmap stages: lead / qualified / proposal / poc / negotiation / won / lost */
export const CANONICAL_STAGES = [
  "lead",
  "qualified",
  "proposal",
  "poc",
  "negotiation",
  "won",
  "lost",
] as const;

export type CanonicalStage = (typeof CANONICAL_STAGES)[number];

const LEGACY_TO_CANONICAL: Record<string, CanonicalStage> = {
  discovery: "lead",
  qualification: "qualified",
};

/** Map legacy stage values to canonical without destructive schema changes. */
export function normalizeOpportunityStage(stage: string): CanonicalStage {
  const mapped = LEGACY_TO_CANONICAL[stage];
  if (mapped) return mapped;
  if ((CANONICAL_STAGES as readonly string[]).includes(stage)) {
    return stage as CanonicalStage;
  }
  return "lead";
}

export function displayOpportunityStage(stage: string): string {
  return normalizeOpportunityStage(stage);
}

export function nextOpportunityStage(stage: string): CanonicalStage | null {
  const canonical = normalizeOpportunityStage(stage);
  const idx = CANONICAL_STAGES.indexOf(canonical);
  if (idx < 0 || idx >= CANONICAL_STAGES.length - 2) return null;
  return CANONICAL_STAGES[idx + 1]!;
}
