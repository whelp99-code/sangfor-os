import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe("phase13 run schema", () => {
  it("rejects source entity when only type is set", async () => {
    const { runPhase13Schema } = await import("./phase13-orchestrator");
    expect(() =>
      runPhase13Schema.parse({
        inputSummary: "valid summary",
        sourceEntityType: "opportunity",
      }),
    ).toThrow();
  });

  it("accepts paired source entity fields", async () => {
    const { runPhase13Schema } = await import("./phase13-orchestrator");
    const parsed = runPhase13Schema.parse({
      inputSummary: "valid summary",
      sourceEntityType: "poc",
      sourceEntityId: "poc-123",
      module: "poc",
    });
    expect(parsed.sourceEntityType).toBe("poc");
    expect(parsed.sourceEntityId).toBe("poc-123");
  });

  it("accepts execution profile enum", async () => {
    const { runPhase13Schema } = await import("./phase13-orchestrator");
    const parsed = runPhase13Schema.parse({
      inputSummary: "valid summary",
      executionProfile: "smoke",
    });
    expect(parsed.executionProfile).toBe("smoke");
  });
});

describe("phase13 skill router unit", () => {
  it("includes poc assumption skills when module is poc", async () => {
    const { recommendSkills } = await import("./skill-router");
    const keys = recommendSkills({
      inputSummary: "PoC validation plan for HCI",
      phase: 13,
      module: "poc",
    });
    expect(keys).toContain("identify-assumptions-existing");
    expect(keys).toContain("brainstorm-experiments-existing");
  });
  it("recommends default phase 13 flow", async () => {
    const { recommendSkills } = await import("./skill-router");
    const keys = recommendSkills({
      inputSummary: "Add customer export feature",
      phase: 13,
    });
    expect(keys).toContain("analyze-feature-requests");
    expect(keys).toContain("aios-work-breakdown");
  });

  it("prepends error skills for bug reports", async () => {
    const { recommendSkills } = await import("./skill-router");
    const keys = recommendSkills({
      inputSummary: "Fix login error on orchestrator page",
      phase: 13,
    });
    expect(keys[0]).toBe("aios-error-to-improvement");
  });

  it("uses PHASE13_SKILL_KEYS env override when set", async () => {
    const prev = process.env.PHASE13_SKILL_KEYS;
    process.env.PHASE13_SKILL_KEYS = "aios-impact-analysis,aios-work-breakdown";
    try {
      const { recommendSkills } = await import("./skill-router");
      const keys = recommendSkills({
        inputSummary: "Add customer export feature",
        phase: 13,
      });
      expect(keys).toEqual(["aios-impact-analysis", "aios-work-breakdown"]);
    } finally {
      if (prev === undefined) delete process.env.PHASE13_SKILL_KEYS;
      else process.env.PHASE13_SKILL_KEYS = prev;
    }
  });

  it("uses executionProfile smoke fixed skills", async () => {
    const { recommendSkills } = await import("./skill-router");
    const keys = recommendSkills({
      inputSummary: "smoke run",
      phase: 13,
      executionProfile: "smoke",
    });
    expect(keys).toEqual([
      "aios-impact-analysis",
      "aios-work-breakdown",
      "aios-agent-assignment",
    ]);
  });

  it("attaches assignment metadata to orchestrator result shape", async () => {
    const { recommendAssignmentForWorkItem } = await import("./phase13-assignment-rules");
    const { buildHandoffDraft } = await import("./phase13-handoff");

    const assignment = recommendAssignmentForWorkItem({
      title: "Add Prisma migration",
      targetArea: "packages/db",
    });
    expect(assignment.suggestedAgent).toBe("codex");

    const draft = buildHandoffDraft({
      commandRunId: "run-x",
      inputSummary: "Test",
      sourceEntityType: "poc",
      sourceEntityId: "poc-1",
      skillKeys: ["aios-work-breakdown"],
      workItems: [
        {
          title: "Add Prisma migration",
          targetArea: "packages/db",
          agentType: "codex",
          assignment,
        },
      ],
    });
    expect(draft.validationCommands.length).toBeGreaterThan(0);
    expect(draft.guardrails.join(" ")).toMatch(/Mail OAuth/i);
  });

  it("keeps work-breakdown criteria when assignment skills run later", async () => {
    const { workBreakdownFromSkillOutput } = await import("./skill-to-work-breakdown");

    let drafts = workBreakdownFromSkillOutput(
      "aios-work-breakdown",
      {
        items: [
          {
            title: "Implement export",
            targetArea: "automation",
            agentType: "cursor",
            riskLevel: "medium",
            estimatedHours: 2,
            acceptanceCriteria: ["Export works"],
            testCriteria: ["Regression test passes"],
          },
        ],
      },
      "Implement export",
    );

    const assignmentDrafts = workBreakdownFromSkillOutput(
      "aios-agent-assignment",
      {
        assignments: [
          {
            itemTitle: "Implement export",
            agentType: "codex",
            rationale: "Review and tests",
          },
        ],
      },
      "Implement export",
    );

    if (assignmentDrafts.length > 0 && drafts.length === 0) {
      drafts = assignmentDrafts;
    }

    expect(drafts[0]?.acceptanceCriteria).toContain("Export works");
    expect(drafts[0]?.testCriteria).toContain("Regression test passes");
  });
});

describe.skipIf(!integrationEnabled)("phase13 orchestrator integration", () => {
  it("runs template-only pipeline and persists breakdown items", async () => {
    const { runPhase13Orchestrator, getPhase13RunDetail } = await import(
      "./phase13-orchestrator"
    );
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const result = await runPhase13Orchestrator({
        inputSummary: "Integration test Phase 13 orchestrator run",
        projectSlug: "demo-project",
        phase: 13,
      });

      expect(result.commandRunId).toBeTruthy();
      expect(result.skillRuns.length).toBeGreaterThan(3);
      expect(result.workBreakdownItems.length).toBeGreaterThan(0);
      expect(result.skillRuns.every((run) => run.executionMode === "template")).toBe(
        true,
      );

      const detail = await getPhase13RunDetail(result.commandRunId);
      expect(detail?.workBreakdownItems.length).toBeGreaterThan(0);
      expect(result.handoffDraft?.validationCommands.length).toBeGreaterThan(0);
      expect(result.workBreakdownItems[0]?.suggestedAgent).toBeTruthy();
    } finally {
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
    }
  }, 30_000);

  it("persists source entity linkage on command run", async () => {
    const { runPhase13Orchestrator, getPhase13RunDetail } = await import(
      "./phase13-orchestrator"
    );

    const result = await runPhase13Orchestrator({
      inputSummary: "Portal binding test for opportunity entity",
      projectSlug: "demo-project",
      phase: 13,
      sourceEntityType: "opportunity",
      sourceEntityId: "opp-smoke-test-id",
    });

    expect(result.sourceEntityType).toBe("opportunity");
    expect(result.sourceEntityId).toBe("opp-smoke-test-id");

    const detail = await getPhase13RunDetail(result.commandRunId);
    expect(detail?.sourceEntityType).toBe("opportunity");
    expect(detail?.sourceEntityId).toBe("opp-smoke-test-id");
  }, 30_000);
});
