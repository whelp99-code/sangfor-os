import type { ContextPack } from "./types";
import { templateKeySchema, type TemplateKey, type TemplateRenderOutput } from "./types";

export const TEMPLATE_REGISTRY: Record<
  TemplateKey,
  { title: string; description: string }
> = {
  "proposal-prd": {
    title: "Proposal PRD",
    description: "Product requirements draft from opportunity/proposal context.",
  },
  "poc-experiment-plan": {
    title: "PoC experiment plan",
    description: "Assumptions, experiments, and validation steps for PoC.",
  },
  "dev-implementation-plan": {
    title: "Development implementation plan",
    description: "Engineering work breakdown and delivery plan.",
  },
  "bugfix-improvement-plan": {
    title: "Bugfix / improvement plan",
    description: "Root cause, fix scope, and regression checks.",
  },
  "release-closeout-plan": {
    title: "Release closeout plan",
    description: "Release checklist, docs, and operational handoff.",
  },
};

function sectionBlock(pack: ContextPack, key: string): string {
  const section = pack.sections.find((s) => s.key === key);
  if (!section || section.empty) return "(empty)";
  return section.content;
}

function allContextAppendix(pack: ContextPack): string {
  return pack.sections
    .filter((s) => !s.empty)
    .map((s) => `### ${s.title}\n${s.content}`)
    .join("\n\n");
}

export function listTemplateKeys(): TemplateKey[] {
  return templateKeySchema.options;
}

export function renderDeterministicTemplate(
  templateKey: TemplateKey,
  contextPack: ContextPack,
  inputSummary?: string,
): TemplateRenderOutput {
  const meta = TEMPLATE_REGISTRY[templateKey];
  const summary = inputSummary?.trim() || "Phase 14 deterministic template output";
  const appendix = allContextAppendix(contextPack);

  const bodies: Record<TemplateKey, string> = {
    "proposal-prd": [
      `# ${meta.title}`,
      "",
      "## Objective",
      summary,
      "",
      "## Opportunity context",
      sectionBlock(contextPack, "opportunity"),
      "",
      "## Proposal context",
      sectionBlock(contextPack, "proposal"),
      "",
      "## Customer & partner",
      `Customer:\n${sectionBlock(contextPack, "customer")}`,
      "",
      `Partner:\n${sectionBlock(contextPack, "partner")}`,
      "",
      "## Knowledge references",
      sectionBlock(contextPack, "knowledgeCitations"),
      "",
      "## Linked tasks",
      sectionBlock(contextPack, "linkedTasks"),
      "",
      "## Appendix",
      appendix || "(no appendix)",
    ].join("\n"),
    "poc-experiment-plan": [
      `# ${meta.title}`,
      "",
      "## PoC scope",
      sectionBlock(contextPack, "poc"),
      "",
      "## Experiments",
      "1. Validate core assumptions from PoC requirements.",
      "2. Run smoke tests on critical integration paths.",
      "3. Capture evidence in result reports.",
      "",
      "## Knowledge references",
      sectionBlock(contextPack, "knowledgeCitations"),
      "",
      "## Linked tasks",
      sectionBlock(contextPack, "linkedTasks"),
    ].join("\n"),
    "dev-implementation-plan": [
      `# ${meta.title}`,
      "",
      "## Request",
      summary,
      "",
      "## Context",
      sectionBlock(contextPack, "opportunity"),
      "",
      "## Implementation notes",
      "- Follow additive migrations and portal guardrails.",
      "- No Mail OAuth/Graph/send/delete/move in portal body.",
      "",
      "## Linked tasks",
      sectionBlock(contextPack, "linkedTasks"),
    ].join("\n"),
    "bugfix-improvement-plan": [
      `# ${meta.title}`,
      "",
      "## Problem statement",
      summary,
      "",
      "## Impact",
      sectionBlock(contextPack, "opportunity") || sectionBlock(contextPack, "poc"),
      "",
      "## Fix approach",
      "1. Reproduce and isolate root cause.",
      "2. Apply minimal fix with regression tests.",
      "3. Route through Phase 15 improvement loop if recurring.",
      "",
      "## Knowledge references",
      sectionBlock(contextPack, "knowledgeCitations"),
    ].join("\n"),
    "release-closeout-plan": [
      `# ${meta.title}`,
      "",
      "## Release scope",
      summary,
      "",
      "## Checklist",
      "- [ ] CI verify + Secret Scan green",
      "- [ ] route-smoke PASS",
      "- [ ] daily-development-status updated",
      "- [ ] Owner approval before production tag/deploy",
      "",
      "## Context appendix",
      appendix || "(no appendix)",
    ].join("\n"),
  };

  return {
    templateKey,
    title: meta.title,
    bodyMarkdown: bodies[templateKey],
    deterministic: true,
  };
}
