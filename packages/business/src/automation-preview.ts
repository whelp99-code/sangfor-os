import { z } from "zod";

import { getOpenAiModel, getOpenAiApiKey } from "./openai-config";
import { recommendAssignmentForWorkItem } from "./skills/phase13-assignment-rules";
import { recommendSkills } from "./skills/skill-router";
import { traceWorkflowEvent } from "./langfuse-observability";

const forbiddenMailActionPattern =
  /\b(mail\.(oauth|graph|send|delete|move)|mail\s+(oauth|graph|send|delete|move))\b/i;

export const analyzeIntentInputSchema = z.object({
  rawText: z.string().min(3).max(20_000),
  commandId: z.string().min(1).optional(),
});

export const createExecutionPlanInputSchema = analyzeIntentInputSchema.extend({
  includeApprovalSummary: z.boolean().optional().default(true),
  includePrDraft: z.boolean().optional().default(true),
});

export const assessRiskInputSchema = z.object({
  commandId: z.string().min(1).optional(),
  rawText: z.string().max(20_000).optional(),
  expectedFiles: z.array(z.string().min(1)).optional().default([]),
  dbChangeRequired: z.boolean().optional().default(false),
  migrationRequired: z.boolean().optional().default(false),
});

export type IntentAnalysis = {
  commandId: string | null;
  summary: string;
  requestType: "feature" | "bugfix" | "ops" | "docs" | "unknown";
  targetAreas: string[];
  skillKeys: string[];
  signals: string[];
  modelRouting: {
    strategy: "deterministic_preview";
    openaiConfigured: boolean;
    model: string;
  };
  previewOnly: true;
};

export type ExecutionPlanItem = {
  id: string;
  title: string;
  targetArea: string;
  suggestedAgent: string;
  riskLevel: "low" | "medium" | "high";
  validationCommands: string[];
};

export type ExecutionPlanPreview = {
  commandId: string | null;
  title: string;
  items: ExecutionPlanItem[];
  skillKeys: string[];
  previewOnly: true;
};

export type RiskAssessmentPreview = {
  commandId: string | null;
  riskLevel: "low" | "medium" | "high";
  approvalRequired: boolean;
  reasons: string[];
  guardrails: string[];
  previewOnly: true;
};

export type ApprovalSummaryPreview = {
  headline: string;
  decisionReason: string;
  recommendedChecks: string[];
  previewOnly: true;
};

export type PrDraftPreview = {
  title: string;
  body: string;
  labels: string[];
  previewOnly: true;
};

function summarize(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 280);
}

function detectRequestType(text: string): IntentAnalysis["requestType"] {
  if (/\b(error|fail|bug|fix|broken|500|exception)\b/i.test(text)) return "bugfix";
  if (/\b(release|deploy|staging|prod|backup|restore|ops|apm)\b/i.test(text)) return "ops";
  if (/\b(doc|docs|readme|report|checklist)\b/i.test(text)) return "docs";
  if (/\b(add|build|implement|create|feature|ui|api|runtime)\b/i.test(text)) return "feature";
  return "unknown";
}

function detectTargetAreas(text: string) {
  const areas = new Set<string>();
  if (/\b(ui|screen|page|component|dashboard|card|button)\b/i.test(text)) areas.add("ui");
  if (/\b(api|route|endpoint|server|backend)\b/i.test(text)) areas.add("api");
  if (/\b(db|database|prisma|migration|schema|sql)\b/i.test(text)) areas.add("db");
  if (/\b(mail|candidate|knowledge|attachment|sync)\b/i.test(text)) areas.add("mail-intelligence");
  if (/\b(llm|openai|skill|phase13|orchestrator|automation)\b/i.test(text)) {
    areas.add("automation");
  }
  if (/\b(test|ci|smoke|validation|lint|build)\b/i.test(text)) areas.add("validation");
  return areas.size > 0 ? [...areas] : ["automation"];
}

function detectSignals(text: string) {
  const signals = [];
  if (forbiddenMailActionPattern.test(text)) signals.push("forbidden-mail-write-risk");
  if (/\b(migration|schema|sql|db)\b/i.test(text)) signals.push("db-impact");
  if (/\b(approval|gate|authorize)\b/i.test(text)) signals.push("approval-gate");
  if (/\b(openai|llm|token|model)\b/i.test(text)) signals.push("llm-routing");
  if (/\b(production|deploy|tag|release)\b/i.test(text)) signals.push("release-guardrail");
  return signals;
}

export function analyzeIntent(input: z.input<typeof analyzeIntentInputSchema>): IntentAnalysis {
  const parsed = analyzeIntentInputSchema.parse(input);
  const inputSummary = summarize(parsed.rawText);
  const skillKeys = recommendSkills({ inputSummary, phase: 13 });
  const analysis: IntentAnalysis = {
    commandId: parsed.commandId ?? null,
    summary: inputSummary,
    requestType: detectRequestType(parsed.rawText),
    targetAreas: detectTargetAreas(parsed.rawText),
    skillKeys,
    signals: detectSignals(parsed.rawText),
    modelRouting: {
      strategy: "deterministic_preview",
      openaiConfigured: Boolean(getOpenAiApiKey()),
      model: getOpenAiModel(),
    },
    previewOnly: true,
  };
  void traceWorkflowEvent({
    event: "phase13.skillRecommendation",
    phase: 13,
    metadata: {
      previewOnly: true,
      targetAreas: analysis.targetAreas,
      skillKeys: analysis.skillKeys,
      requestType: analysis.requestType,
    },
  });
  return analysis;
}

function buildPlanItems(analysis: IntentAnalysis): ExecutionPlanItem[] {
  const primaryArea = analysis.targetAreas[0] ?? "automation";
  const assignment = recommendAssignmentForWorkItem({
    title: analysis.summary,
    description: analysis.signals.join(", "),
    targetArea: primaryArea,
  });
  const riskLevel: ExecutionPlanItem["riskLevel"] =
    analysis.signals.includes("forbidden-mail-write-risk") || analysis.signals.includes("db-impact")
      ? "high"
      : analysis.signals.includes("release-guardrail")
        ? "medium"
        : "low";

  return [
    {
      id: "preview-1",
      title: "Review source context and guardrails",
      targetArea: primaryArea,
      suggestedAgent: assignment.suggestedAgent,
      riskLevel,
      validationCommands: ["git diff --stat", "rg \"mail\\.(send|delete|move|oauth|graph)\""],
    },
    {
      id: "preview-2",
      title: `Implement ${analysis.requestType} preview safely`,
      targetArea: primaryArea,
      suggestedAgent: assignment.suggestedAgent,
      riskLevel,
      validationCommands: ["pnpm lint", "pnpm build"],
    },
    {
      id: "preview-3",
      title: "Verify non-destructive behavior",
      targetArea: "validation",
      suggestedAgent: "codex",
      riskLevel,
      validationCommands: ["CI_INTEGRATION=1 pnpm test", "./scripts/route-smoke.sh"],
    },
  ];
}

export function assessRisk(input: z.input<typeof assessRiskInputSchema>): RiskAssessmentPreview {
  const parsed = assessRiskInputSchema.parse(input);
  const reasons: string[] = [];
  if (parsed.dbChangeRequired) reasons.push("DB change requested");
  if (parsed.migrationRequired) reasons.push("Migration requested");
  if (parsed.expectedFiles.some((file) => /prisma|migration|schema|sql/i.test(file))) {
    reasons.push("Expected file list touches DB/schema area");
  }
  if (parsed.rawText && forbiddenMailActionPattern.test(parsed.rawText)) {
    reasons.push("Forbidden Mail OAuth/Graph/send/delete/move intent detected");
  }
  if (parsed.expectedFiles.some((file) => /api|packages\/automation|packages\/db/i.test(file))) {
    reasons.push("Runtime/API package impact");
  }

  const riskLevel: RiskAssessmentPreview["riskLevel"] =
    reasons.some((reason) => /forbidden|migration|schema/i.test(reason))
      ? "high"
      : reasons.length > 0
        ? "medium"
        : "low";

  return {
    commandId: parsed.commandId ?? null,
    riskLevel,
    approvalRequired: riskLevel !== "low" || parsed.dbChangeRequired || parsed.migrationRequired,
    reasons: reasons.length > 0 ? reasons : ["Preview-only request; no direct write detected"],
    guardrails: [
      "Preview API must not create business records by default.",
      "No Mail OAuth/Graph/send/delete/move in portal body.",
      "Production tag/deploy remains separately approved.",
      "Migrations must be additive when explicitly approved.",
    ],
    previewOnly: true,
  };
}

export function buildApprovalSummary(input: {
  plan: ExecutionPlanPreview;
  risk: RiskAssessmentPreview;
}): ApprovalSummaryPreview {
  const blocked = input.risk.reasons.some((reason) => /forbidden/i.test(reason));
  return {
    headline: blocked
      ? "Blocked until forbidden action is removed"
      : input.risk.approvalRequired
        ? "Approval recommended before implementation"
        : "Low-risk preview can proceed",
    decisionReason: `${input.risk.riskLevel.toUpperCase()} risk · ${input.plan.items.length} planned checks · preview-only`,
    recommendedChecks: [
      "Confirm DB row counts are unchanged after preview API smoke.",
      "Confirm mail candidate approval flow remains intact.",
      "Confirm forbidden Mail write actions are absent.",
    ],
    previewOnly: true,
  };
}

export function createPrDraft(input: {
  analysis: IntentAnalysis;
  plan: ExecutionPlanPreview;
  risk: RiskAssessmentPreview;
}): PrDraftPreview {
  return {
    title: `preview: ${input.analysis.summary.slice(0, 72)}`,
    body: [
      "## Summary",
      input.analysis.summary,
      "",
      "## Plan",
      ...input.plan.items.map((item) => `- ${item.title} (${item.targetArea}, ${item.riskLevel})`),
      "",
      "## Risk",
      `- ${input.risk.riskLevel}`,
      ...input.risk.reasons.map((reason) => `- ${reason}`),
      "",
      "## Guardrails",
      ...input.risk.guardrails.map((guardrail) => `- ${guardrail}`),
    ].join("\n"),
    labels: ["automation", "preview-only"],
    previewOnly: true,
  };
}

export function createExecutionPlan(
  input: z.input<typeof createExecutionPlanInputSchema>,
): {
  analysis: IntentAnalysis;
  plan: ExecutionPlanPreview;
  risk: RiskAssessmentPreview;
  approvalSummary?: ApprovalSummaryPreview;
  prDraft?: PrDraftPreview;
  previewOnly: true;
} {
  const parsed = createExecutionPlanInputSchema.parse(input);
  const analysis = analyzeIntent(parsed);
  const plan: ExecutionPlanPreview = {
    commandId: parsed.commandId ?? null,
    title: `Preview plan: ${analysis.summary.slice(0, 96)}`,
    items: buildPlanItems(analysis),
    skillKeys: analysis.skillKeys,
    previewOnly: true,
  };
  const risk = assessRisk({
    commandId: parsed.commandId,
    rawText: parsed.rawText,
    expectedFiles: plan.items.flatMap((item) =>
      item.targetArea === "db"
        ? ["packages/db/prisma/schema.prisma"]
        : item.targetArea === "ui"
          ? ["apps/web/src/components"]
          : ["packages/automation/src"],
    ),
    dbChangeRequired: analysis.signals.includes("db-impact"),
    migrationRequired: /\bmigration\b/i.test(parsed.rawText),
  });

  return {
    analysis,
    plan,
    risk,
    approvalSummary: parsed.includeApprovalSummary
      ? buildApprovalSummary({ plan, risk })
      : undefined,
    prDraft: parsed.includePrDraft ? createPrDraft({ analysis, plan, risk }) : undefined,
    previewOnly: true,
  };
}
