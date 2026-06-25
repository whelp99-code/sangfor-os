import { z } from "zod";

export const suggestedAgentSchema = z.enum([
  "codex",
  "cursor",
  "docs",
  "human",
  "needs_triage",
]);

export type SuggestedAgent = z.infer<typeof suggestedAgentSchema>;

export type AssignmentSuggestion = {
  suggestedOwner?: string;
  suggestedAgent: SuggestedAgent;
  confidence: number;
  reason: string;
};

type Rule = {
  pattern: RegExp;
  agent: SuggestedAgent;
  owner?: string;
  confidence: number;
  reason: string;
};

const RULES: Rule[] = [
  {
    pattern:
      /\b(prisma|migration|schema|postgres|database|db\b|api route|backend|nestjs|validation|test suite|ci_integration)\b/i,
    agent: "codex",
    owner: "backend",
    confidence: 0.88,
    reason: "Backend, API, database, or test work",
  },
  {
    pattern:
      /\b(ui|page|component|form|interaction|registry block|tailwind|react|next\.js|orchestrator panel)\b/i,
    agent: "cursor",
    owner: "frontend",
    confidence: 0.86,
    reason: "UI or portal integration work",
  },
  {
    pattern:
      /\b(docs?|readme|release notes|checklist|report|guide|daily status|documentation)\b/i,
    agent: "docs",
    owner: "docs",
    confidence: 0.82,
    reason: "Documentation or release artifact",
  },
  {
    pattern:
      /\b(security|auth|secret|permission|jwt|oauth|hipaa|credential)\b/i,
    agent: "codex",
    owner: "security-review",
    confidence: 0.9,
    reason: "Security-sensitive change — codex + human review",
  },
];

function normalizeText(parts: Array<string | undefined | null>) {
  return parts.filter(Boolean).join(" ").toLowerCase();
}

export function recommendAssignmentForWorkItem(input: {
  title: string;
  description?: string | null;
  targetArea?: string | null;
}): AssignmentSuggestion {
  const haystack = normalizeText([input.title, input.description, input.targetArea]);

  if (/\b(improve experience|better ux|make it nicer|polish feel)\b/i.test(haystack)) {
    return {
      suggestedAgent: "needs_triage",
      suggestedOwner: "product",
      confidence: 0.45,
      reason: "Ambiguous product/UX goal — needs triage",
    };
  }

  let best: AssignmentSuggestion | null = null;
  for (const rule of RULES) {
    if (!rule.pattern.test(haystack)) continue;
    const candidate: AssignmentSuggestion = {
      suggestedAgent: rule.agent,
      suggestedOwner: rule.owner,
      confidence: rule.confidence,
      reason: rule.reason,
    };
    if (!best || candidate.confidence > best.confidence) {
      best = candidate;
    }
  }

  if (best) return best;

  const area = (input.targetArea ?? "").toLowerCase();
  if (area.includes("automation") || area.includes("api")) {
    return {
      suggestedAgent: "codex",
      suggestedOwner: "backend",
      confidence: 0.65,
      reason: "Default automation/API target area",
    };
  }
  if (area.includes("ui") || area.includes("web")) {
    return {
      suggestedAgent: "cursor",
      suggestedOwner: "frontend",
      confidence: 0.65,
      reason: "Default UI target area",
    };
  }

  return {
    suggestedAgent: "needs_triage",
    suggestedOwner: "team",
    confidence: 0.4,
    reason: "No strong routing signal — triage recommended",
  };
}
