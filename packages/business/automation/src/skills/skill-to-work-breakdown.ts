import type { AgentType, WorkBreakdownDraft } from "./types";

type BreakdownItemInput = {
  title?: string;
  description?: string;
  targetArea?: string;
  agentType?: string;
  riskLevel?: string;
  estimatedHours?: number;
  acceptanceCriteria?: string[];
  testCriteria?: string[];
};

function coerceAgentType(value?: string): AgentType {
  if (value === "codex" || value === "human") return value;
  return "cursor";
}

function coerceRisk(value?: string): "low" | "medium" | "high" {
  if (value === "medium" || value === "high") return value;
  return "low";
}

export function workBreakdownFromNormalizedData(
  normalized: Record<string, unknown>,
  fallbackTitle: string,
): WorkBreakdownDraft[] {
  const items = normalized.items;
  if (Array.isArray(items) && items.length > 0) {
    return items.map((item, index) => {
      const row = item as BreakdownItemInput;
      return {
        title: row.title ?? `Work item ${index + 1}`,
        description: row.description,
        targetArea: row.targetArea ?? "automation",
        agentType: coerceAgentType(row.agentType),
        riskLevel: coerceRisk(row.riskLevel),
        estimatedHours: row.estimatedHours ?? 2,
        acceptanceCriteria: row.acceptanceCriteria,
        testCriteria: row.testCriteria,
      };
    });
  }

  const assignments = normalized.assignments;
  if (Array.isArray(assignments) && assignments.length > 0) {
    return assignments.map((item, index) => {
      const row = item as { itemTitle?: string; agentType?: string; rationale?: string };
      return {
        title: row.itemTitle ?? `Assignment ${index + 1}`,
        description: row.rationale,
        targetArea: "automation",
        agentType: coerceAgentType(row.agentType),
        riskLevel: "low",
        estimatedHours: 2,
      };
    });
  }

  return [
    {
      title: fallbackTitle.slice(0, 120),
      description: fallbackTitle,
      targetArea: "automation",
      agentType: "cursor",
      riskLevel: "medium",
      estimatedHours: 2,
      acceptanceCriteria: ["Implementation complete", "Tests pass"],
      testCriteria: ["pnpm test"],
    },
  ];
}

export function workBreakdownFromSkillOutput(
  skillKey: string,
  normalized: Record<string, unknown>,
  inputSummary: string,
): WorkBreakdownDraft[] {
  if (skillKey === "aios-work-breakdown" || skillKey === "aios-agent-assignment") {
    return workBreakdownFromNormalizedData(normalized, inputSummary);
  }
  return [];
}
