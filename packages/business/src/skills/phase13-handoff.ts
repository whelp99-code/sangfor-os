import type { AssignmentSuggestion, SuggestedAgent } from "./phase13-assignment-rules";

export type HandoffWorkItem = {
  title: string;
  targetArea: string;
  agentType: string;
  assignment?: AssignmentSuggestion;
};

export type HandoffDraft = {
  cursorInstruction: string;
  codexValidationInstruction: string;
  suggestedBranch: string;
  validationCommands: string[];
  guardrails: string[];
  sourceEntitySummary?: string;
  contextPackSummary?: string;
};

const DEFAULT_GUARDRAILS = [
  "No Mail OAuth / Graph / send / delete / move in portal body",
  "Additive Prisma migrations only — no destructive schema changes",
  "No production deploy or tag without owner approval",
  "Do not commit secrets, * 2.* junk files, or empty zip artifacts",
];

export function buildHandoffDraft(input: {
  commandRunId: string;
  inputSummary: string;
  sourceEntityType?: string | null;
  sourceEntityId?: string | null;
  workItems: HandoffWorkItem[];
  skillKeys: string[];
  contextPackSummary?: string | null;
}): HandoffDraft {
  const entityLine =
    input.sourceEntityType && input.sourceEntityId
      ? `${input.sourceEntityType} ${input.sourceEntityId}`
      : "standalone orchestrator run";

  const breakdownLines = input.workItems
    .map((item, index) => {
      const assign = item.assignment;
      const agent = assign?.suggestedAgent ?? item.agentType;
      const owner = assign?.suggestedOwner ?? "unassigned";
      return `${index + 1}. [${agent}/${owner}] ${item.title} (${item.targetArea}) — ${assign?.reason ?? "from breakdown"}`;
    })
    .join("\n");

  const cursorItems = input.workItems.filter(
    (item) =>
      item.assignment?.suggestedAgent === "cursor" ||
      item.agentType === "cursor",
  );
  const codexItems = input.workItems.filter(
    (item) =>
      item.assignment?.suggestedAgent === "codex" ||
      item.agentType === "codex" ||
      item.assignment?.suggestedAgent === "human",
  );

  const contextPackBlock = input.contextPackSummary?.trim()
    ? ["", "Context pack:", input.contextPackSummary.slice(0, 800)]
    : [];

  const cursorInstruction = [
    `Implement Phase 13 follow-up for command run ${input.commandRunId}.`,
    `Source: ${entityLine}.`,
    `Summary: ${input.inputSummary.slice(0, 500)}`,
    ...contextPackBlock,
    "",
    "Focus items:",
    cursorItems.length > 0
      ? cursorItems.map((i) => `- ${i.title}`).join("\n")
      : "- No cursor-priority items; review breakdown for UI tasks",
    "",
    "Skills executed:",
    input.skillKeys.join(", "),
  ].join("\n");

  const codexValidationInstruction = [
    `Validate Phase 13 orchestrator output for command run ${input.commandRunId}.`,
    `Source: ${entityLine}.`,
    ...(input.contextPackSummary?.trim()
      ? ["", "Context pack summary:", input.contextPackSummary.slice(0, 600)]
      : []),
    "",
    "Review / test focus:",
    codexItems.length > 0
      ? codexItems.map((i) => `- ${i.title}`).join("\n")
      : "- Run full CI_INTEGRATION suite and schema review",
    "",
    "Work breakdown:",
    breakdownLines,
  ].join("\n");

  return {
    cursorInstruction,
    codexValidationInstruction,
    suggestedBranch: "feature/phase13-orchestrator-runtime-v2",
    validationCommands: [
      "bash scripts/validate-pm-skills.sh",
      "bash scripts/sync-pm-skills.sh --check",
      "pnpm lint",
      "CI_INTEGRATION=1 pnpm test",
      "pnpm build",
      "./scripts/route-smoke.sh",
    ],
    guardrails: DEFAULT_GUARDRAILS,
    sourceEntitySummary: `${entityLine}\n${input.inputSummary.slice(0, 400)}`,
    contextPackSummary: input.contextPackSummary?.trim() || undefined,
  };
}

export function summarizeAgentRouting(items: HandoffWorkItem[]): SuggestedAgent[] {
  return [...new Set(items.map((item) => item.assignment?.suggestedAgent ?? "needs_triage"))];
}
