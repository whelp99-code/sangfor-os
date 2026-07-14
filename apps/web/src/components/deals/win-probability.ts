import { normalizeOpportunityStage } from "@sangfor/business/opportunity-stage";

export function winProbabilityLabel(probability: number | null | undefined, stage: string): string {
  const normalized = normalizeOpportunityStage(stage);
  if (normalized === "WON") return "100%";
  if (normalized === "LOST") return "0%";
  return probability == null ? "미정" : `${probability}%`;
}
