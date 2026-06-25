import { describe, expect, it } from "vitest";

import { buildHandoffDraft } from "./phase13-handoff";

describe("phase13 handoff draft", () => {
  const base = {
    commandRunId: "run-1",
    inputSummary: "Portal binding for opportunity pipeline",
    sourceEntityType: "opportunity",
    sourceEntityId: "opp-1",
    skillKeys: ["aios-work-breakdown"],
    workItems: [
      {
        title: "Wire orchestrator panel",
        targetArea: "apps/web",
        agentType: "cursor",
        assignment: {
          suggestedAgent: "cursor" as const,
          suggestedOwner: "frontend",
          confidence: 0.9,
          reason: "UI work",
        },
      },
    ],
  };

  it("includes validation commands", () => {
    const draft = buildHandoffDraft(base);
    expect(draft.validationCommands).toContain("pnpm lint");
    expect(draft.validationCommands).toContain("./scripts/route-smoke.sh");
  });

  it("includes source entity in summary", () => {
    const draft = buildHandoffDraft(base);
    expect(draft.sourceEntitySummary).toContain("opportunity");
    expect(draft.sourceEntitySummary).toContain("opp-1");
  });

  it("includes mail forbidden guardrail", () => {
    const draft = buildHandoffDraft(base);
    expect(
      draft.guardrails.some((g) => g.toLowerCase().includes("mail oauth")),
    ).toBe(true);
  });

  it("includes additive migration guardrail", () => {
    const draft = buildHandoffDraft(base);
    expect(draft.guardrails.some((g) => g.toLowerCase().includes("additive"))).toBe(
      true,
    );
  });
});
