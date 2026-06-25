export * from "./status.js";

export const PROJECT_NAME = "AI Automation Work Portal" as const;
export const PROJECT_PHASE = 13 as const;
export const PROJECT_TAGLINE =
  "AI업무포탈 with an embedded development automation kernel." as const;

/** Client-safe proposal template keys (mirrors automation generator). */
export const PROPOSAL_TEMPLATE_KEYS = [
  "standard-proposal",
  "poc-summary",
  "technical-spec",
  "pricing-sheet",
  "executive-brief",
  "implementation-plan",
  "support-handoff",
] as const;

export type ProposalTemplateKey = (typeof PROPOSAL_TEMPLATE_KEYS)[number];
