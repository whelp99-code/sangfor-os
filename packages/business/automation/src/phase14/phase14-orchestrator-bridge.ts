import { z } from "zod";

import { buildContextPack } from "./context-pack-builder";
import { traceWorkflowEvent } from "../langfuse-observability";
import { renderDeterministicTemplate } from "./template-registry";
import type { ContextPack, TemplateKey, TemplateRenderOutput } from "./types";
import { templateKeySchema } from "./types";

export const phase14RunOptionsSchema = z.object({
  projectSlug: z.string().default("demo-project"),
  sourceEntityType: z.enum(["opportunity", "proposal", "poc"]).optional(),
  sourceEntityId: z.string().min(1).optional(),
  templateKey: templateKeySchema.optional(),
  inputSummary: z.string().min(3),
  includeContextPack: z.boolean().default(true),
});

export type Phase14EnrichedRunInput = {
  inputSummary: string;
  contextPack: ContextPack | null;
  templateOutput: TemplateRenderOutput | null;
  contextPackSummary: string | null;
};

export async function enrichPhase13RunWithContextPack(
  input: z.infer<typeof phase14RunOptionsSchema>,
): Promise<Phase14EnrichedRunInput> {
  const parsed = phase14RunOptionsSchema.parse(input);

  const shouldBuild =
    parsed.includeContextPack &&
    parsed.sourceEntityType != null &&
    parsed.sourceEntityId != null;

  if (!shouldBuild) {
    return {
      inputSummary: parsed.inputSummary,
      contextPack: null,
      templateOutput: null,
      contextPackSummary: null,
    };
  }

  const contextPack = await buildContextPack({
    projectSlug: parsed.projectSlug,
    sourceEntityType: parsed.sourceEntityType,
    sourceEntityId: parsed.sourceEntityId,
    templateKey: parsed.templateKey,
    knowledgeQuery: parsed.inputSummary.slice(0, 120),
  });

  const templateKey: TemplateKey | null =
    parsed.templateKey ?? contextPack.templateKey ?? null;

  const templateOutput = templateKey
    ? renderDeterministicTemplate(templateKey, contextPack, parsed.inputSummary)
    : null;

  const contextPackSummary = contextPack.summaryText;
  void traceWorkflowEvent({
    event: "phase14.contextPack",
    phase: 14,
    contextPackSummary,
    templateKey: templateOutput?.templateKey ?? null,
    templateOutputSummary: templateOutput?.bodyMarkdown.slice(0, 240) ?? null,
    metadata: {
      sourceEntityType: parsed.sourceEntityType,
      sourceEntityId: parsed.sourceEntityId,
      projectSlug: parsed.projectSlug,
    },
  });

  const blocks = [
    "## Phase 14 context pack",
    contextPackSummary,
    templateOutput
      ? `\n## Template (${templateOutput.templateKey})\n${templateOutput.bodyMarkdown.slice(0, 1200)}`
      : null,
    "---",
    parsed.inputSummary,
  ].filter((part) => part != null && part.trim() !== "");

  return {
    inputSummary: blocks.join("\n\n"),
    contextPack,
    templateOutput,
    contextPackSummary,
  };
}
