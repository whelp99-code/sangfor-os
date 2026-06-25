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

describe.skipIf(!integrationEnabled)("Phase 11 DB relations", () => {
  it("passes relation integrity check", async () => {
    const { checkDbRelations } = await import("./db-relations");
    const report = await checkDbRelations();
    expect(report.commandRuns).toBeGreaterThan(0);
    expect(report.orphanToolCalls).toBe(0);
    expect(report.orphanChangedFiles).toBe(0);
    expect(report.chainOk).toBe(true);
    expect(report.ok).toBe(true);
  });
});

describe.skipIf(!integrationEnabled)("Phase 11 command run E2E", () => {
  it("runs full command → workflow → report chain", async () => {
    const { createCommandRun, getCommandRunDetail } = await import("./command-center");
    const { runWorkflowMock } = await import("./workflow-runner");
    const { syncRunTimeline } = await import("./observability");

    const run = await createCommandRun({
      inputSummary: "Beta E2E low risk run",
      projectSlug: "demo-project",
      commandKey: "user-request",
    });

    const completed = await runWorkflowMock(run.id);
    expect(completed?.status).toBe("completed");

    const detail = await getCommandRunDetail(run.id);
    const reportStep = detail?.workflows[0]?.steps.find((s) => s.stepKey === "report");
    const validateStep = detail?.workflows[0]?.steps.find((s) => s.stepKey === "validate");
    expect(validateStep?.validationResults.length).toBeGreaterThan(0);

    const timeline = await syncRunTimeline(run.id);
    expect(timeline.length).toBeGreaterThan(3);
    expect(reportStep?.status).toBe("completed");
  }, 30_000);
});

describe.skipIf(!integrationEnabled)("Phase 11 approval / validation flow", () => {
  it("blocks medium-risk workflow until approved", async () => {
    const { createCommandRun } = await import("./command-center");
    const { runWorkflowMock } = await import("./workflow-runner");
    const { approveRequest } = await import("./approval-gate");
    const { runValidationPlan } = await import("./validation-engine");
    const { prisma } = await import("@ai-portal/db");

    const longSummary = "A".repeat(90);
    const run = await createCommandRun({
      inputSummary: longSummary,
      projectSlug: "demo-project",
      commandKey: "user-request",
    });

    await expect(runWorkflowMock(run.id)).rejects.toThrow("approval_required");

    const approval = await prisma.approvalRequest.findFirst({
      where: { commandRunId: run.id, status: "pending" },
    });
    expect(approval).toBeTruthy();

    await approveRequest(approval!.id);
    const completed = await runWorkflowMock(run.id);
    expect(completed?.status).toBe("completed");

    const plan = await runValidationPlan(run.id, [
      { key: "lint", passed: true },
      { key: "test", passed: true },
      { key: "build", passed: true },
    ]);
    expect(plan.status).toBe("passed");
  }, 40_000);
});

describe.skipIf(!integrationEnabled)("Phase 11 Codex task flow", () => {
  it("creates task, links issue, PR, and completes", async () => {
    const { createCommandRun } = await import("./command-center");
    const {
      createCodexTask,
      linkGitHubIssueToCodexTask,
      completeCodexTaskWithPr,
      finalizeCodexTask,
    } = await import("./codex-task-flow");

    const run = await createCommandRun({
      inputSummary: "Codex flow test",
      projectSlug: "demo-project",
      commandKey: "user-request",
    });

    const task = await createCodexTask(run.id, "Implement beta fix");
    const issue = await linkGitHubIssueToCodexTask(task.id, run.id, "Beta fix issue");
    expect(issue.number).toBeGreaterThan(0);

    const { pullRequest } = await completeCodexTaskWithPr(task.id, run.id);
    expect(pullRequest.number).toBeGreaterThan(0);

    const done = await finalizeCodexTask(task.id);
    expect(done?.status).toBe("completed");
    expect(done?.logs.length).toBeGreaterThan(1);
  }, 30_000);
});

describe.skipIf(!integrationEnabled)("Phase 11 Cursor session flow", () => {
  it("records session, work, and completion", async () => {
    const { createCommandRun } = await import("./command-center");
    const {
      startCursorSession,
      recordCursorSessionWork,
      completeCursorSession,
    } = await import("./cursor-session-flow");

    const run = await createCommandRun({
      inputSummary: "Cursor session test",
      projectSlug: "demo-project",
      commandKey: "user-request",
    });

    const session = await startCursorSession({
      commandRunId: run.id,
      branchName: "release/beta-stabilization-v1",
      taskSummary: "Phase 11 stabilization",
    });

    await recordCursorSessionWork({
      sessionId: session.id,
      commandRunId: run.id,
      summary: "Added beta tests",
      files: ["packages/automation/src/phase11-beta.test.ts"],
      buildStatus: "success",
      testStatus: "passed",
    });

    const completed = await completeCursorSession(session.id);
    expect(completed.status).toBe("completed");
    expect(completed.buildStatus).toBe("success");
  }, 30_000);
});

describe.skipIf(!integrationEnabled)("Phase 11 GitHub PR / CI sync", () => {
  it("creates PR and syncs CI status", async () => {
    const { createCommandRun } = await import("./command-center");
    const { createPullRequestForRun, syncPullRequestCi } = await import("./github-connector");

    const run = await createCommandRun({
      inputSummary: "GitHub sync test",
      projectSlug: "demo-project",
      commandKey: "user-request",
    });

    const pr = await createPullRequestForRun(run.id, "Beta stabilization PR");
    const synced = await syncPullRequestCi(pr.id);
    expect(synced.ciStatus).toBeTruthy();
  }, 20_000);
});

describe.skipIf(!integrationEnabled)("Phase 11 observability trace", () => {
  it("records timeline, transitions, and tool failure", async () => {
    const { createCommandRun } = await import("./command-center");
    const { recordToolFailure, getTraceSummary } = await import("./observability");

    const run = await createCommandRun({
      inputSummary: "Trace test",
      projectSlug: "demo-project",
      commandKey: "user-request",
    });

    await recordToolFailure(run.id, "dry_run_shell", "simulated failure");
    const trace = await getTraceSummary(run.id);
    expect(trace.notifications.some((n) => n.eventType === "tool.failed")).toBe(true);
  }, 20_000);
});
