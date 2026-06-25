import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("command center integration", () => {
  it("creates command run with intent, risk, and workflow steps", async () => {
    const { createCommandRun, getCommandRunDetail, buildTimeline } = await import(
      "./command-center"
    );

    const run = await createCommandRun({
      inputSummary: "Integration test command run",
      projectSlug: "demo-project",
      commandKey: "user-request",
    });

    expect(run.id).toBeTruthy();
    expect(run.status).toBe("running");

    const detail = await getCommandRunDetail(run.id);
    expect(detail?.intent?.summary).toContain("Integration test");
    expect(detail?.risk?.riskLevel).toBeTruthy();
    expect(detail?.workflows[0]?.steps.length).toBeGreaterThanOrEqual(5);

    const timeline = buildTimeline(detail!);
    expect(timeline.length).toBeGreaterThan(2);
  }, 20_000);
});

describe.skipIf(!integrationEnabled)("workflow runner integration", () => {
  it("completes mock workflow for a command run", async () => {
    const { createCommandRun } = await import("./command-center");
    const { runWorkflowMock } = await import("./workflow-runner");

    const run = await createCommandRun({
      inputSummary: "Workflow mock test",
      projectSlug: "demo-project",
      commandKey: "user-request",
    });

    const summary = await runWorkflowMock(run.id);
    expect(summary?.workflows[0]?.steps.every((s) => s.status === "completed")).toBe(true);
  }, 30_000);
});

describe("createCommandRunSchema", () => {
  it("rejects short input summary", async () => {
    const { createCommandRunSchema } = await import("./command-center");
    expect(() => createCommandRunSchema.parse({ inputSummary: "ab" })).toThrow();
  });
});
