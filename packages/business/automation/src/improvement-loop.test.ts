import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe("improvement-loop unit", () => {
  it("infers severity from error message", async () => {
    const { createFromErrorSchema } = await import("./improvement-loop");
    const parsed = createFromErrorSchema.parse({
      message: "Critical database connection failed",
      sourceType: "validation",
    });
    expect(parsed.message).toContain("Critical");
  });
});

describe.skipIf(!integrationEnabled)("improvement-loop integration", () => {
  it("creates, approves, and converts to phase13 run", async () => {
    const {
      createImprovementCandidateFromError,
      approveImprovementCandidate,
      rejectImprovementCandidate,
      convertImprovementToPhase13Run,
    } = await import("./improvement-loop");

    const created = await createImprovementCandidateFromError({
      sourceType: "test",
      sourceId: "smoke-1",
      message: "Route smoke validation failed on orchestrator panel",
      severity: "medium",
    });
    expect(created.status).toBe("proposed");

    const rejected = await createImprovementCandidateFromError({
      message: "Rejected path test error",
      sourceType: "test",
    });
    await rejectImprovementCandidate(rejected.id);

    await expect(convertImprovementToPhase13Run(rejected.id)).rejects.toThrow(
      /rejected/i,
    );

    await approveImprovementCandidate(created.id);
    const { candidate, phase13 } = await convertImprovementToPhase13Run(created.id);

    expect(candidate.status).toBe("converted");
    expect(candidate.commandRunId).toBeTruthy();
    expect(phase13).not.toBeNull();
    if (phase13 && "workBreakdownItems" in phase13) {
      expect(phase13.workBreakdownItems.length).toBeGreaterThan(0);
    }
  }, 45_000);
});
