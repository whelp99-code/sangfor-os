import { describe, expect, it } from "vitest";

import { analyzeIntent, assessRisk, createExecutionPlan } from "./automation-preview";

describe("automation preview facade", () => {
  it("creates deterministic preview analysis without persistence", () => {
    const analysis = analyzeIntent({
      rawText: "Build a compact automation preview API and UI card",
      commandId: "cmd-preview",
    });

    expect(analysis.commandId).toBe("cmd-preview");
    expect(analysis.previewOnly).toBe(true);
    expect(analysis.targetAreas).toContain("api");
    expect(analysis.skillKeys.length).toBeGreaterThan(0);
    expect(analysis.modelRouting.strategy).toBe("deterministic_preview");
  });

  it("returns plan, approval summary, and PR draft as preview-only objects", () => {
    const result = createExecutionPlan({
      rawText: "Implement v1.0.2 automation facade with lint and route-smoke verification",
    });

    expect(result.previewOnly).toBe(true);
    expect(result.plan.previewOnly).toBe(true);
    expect(result.plan.items).toHaveLength(3);
    expect(result.approvalSummary?.previewOnly).toBe(true);
    expect(result.prDraft?.labels).toContain("preview-only");
  });

  it("flags forbidden mail write actions and migration risk", () => {
    const risk = assessRisk({
      rawText: "Add mail.send and a schema migration",
      expectedFiles: ["packages/db/prisma/schema.prisma"],
      dbChangeRequired: true,
      migrationRequired: true,
    });

    expect(risk.previewOnly).toBe(true);
    expect(risk.riskLevel).toBe("high");
    expect(risk.approvalRequired).toBe(true);
    expect(risk.reasons.join(" ")).toMatch(/Forbidden Mail/i);
  });
});
