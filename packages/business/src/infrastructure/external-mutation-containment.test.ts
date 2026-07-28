import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spies = vi.hoisted(() => ({
  octokitConstructor: vi.fn(),
  pullCreate: vi.fn(),
  checksList: vi.fn(),
  repositoryUpsert: vi.fn(),
  pullRequestFindFirst: vi.fn(),
  pullRequestCreate: vi.fn(),
  pullRequestFind: vi.fn(),
  pullRequestUpdate: vi.fn(),
  approvalCreate: vi.fn(),
  traceWorkflowEvent: vi.fn(),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    readonly rest = {
      pulls: { create: spies.pullCreate },
      checks: { listForRef: spies.checksList },
    };

    constructor() {
      spies.octokitConstructor();
    }
  },
}));

vi.mock("@sangfor/db", () => ({
  prisma: {
    repository: { upsert: spies.repositoryUpsert },
    pullRequest: {
      findFirst: spies.pullRequestFindFirst,
      create: spies.pullRequestCreate,
      findUniqueOrThrow: spies.pullRequestFind,
      update: spies.pullRequestUpdate,
    },
    approvalRequest: { create: spies.approvalCreate },
    connectorRegistry: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

vi.mock("../platform/langfuse-observability", () => ({
  traceWorkflowEvent: spies.traceWorkflowEvent,
}));

import { validateAction } from "./action-connector-runtime";
import { createPullRequestForRun, syncPullRequestCi } from "./github-connector";

describe("business external mutation containment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GITHUB_TOKEN", "u002-github-token");
    vi.stubEnv("CONNECTOR_STAGING_MODE", "real");
    spies.repositoryUpsert.mockResolvedValue({ id: "repo-1" });
    spies.pullRequestFindFirst.mockResolvedValue({ number: 100 });
    spies.pullCreate.mockResolvedValue({ data: { number: 101, html_url: "https://example.invalid/pr/101" } });
    spies.pullRequestCreate.mockResolvedValue({ id: "pr-1" });
    spies.approvalCreate.mockResolvedValue({ id: "approval-1" });
    spies.pullRequestFind.mockResolvedValue({ id: "pr-1", number: 101, url: "https://example.invalid/pr/101" });
    spies.checksList.mockResolvedValue({ data: { check_runs: [] } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies pull-request creation before Prisma or Octokit construction", async () => {
    // Given: live GitHub credentials and a command run.

    // When: PR creation is requested.
    const operation = createPullRequestForRun("run-123456789", "Fixture PR");

    // Then: containment denies before any adapter or persistence call.
    await expect(operation).rejects.toMatchObject({ code: "EXTERNAL_MUTATION_CONTAINED" });
    expect(spies.octokitConstructor).toHaveBeenCalledTimes(0);
    expect(spies.repositoryUpsert).toHaveBeenCalledTimes(0);
    expect(spies.pullCreate).toHaveBeenCalledTimes(0);
  });

  it("denies pull-request synchronization before Prisma or Octokit construction", async () => {
    // Given: live GitHub credentials and an existing PR identifier.

    // When: CI synchronization is requested.
    const operation = syncPullRequestCi("pr-1");

    // Then: containment denies before reading state or constructing the adapter.
    await expect(operation).rejects.toMatchObject({ code: "EXTERNAL_MUTATION_CONTAINED" });
    expect(spies.pullRequestFind).toHaveBeenCalledTimes(0);
    expect(spies.octokitConstructor).toHaveBeenCalledTimes(0);
    expect(spies.checksList).toHaveBeenCalledTimes(0);
  });

  it("marks GitHub sync invalid even when live credentials and registry mode exist", () => {
    // Given: live connector flags and a real registry status.

    // When: the action runtime validates GitHub synchronization.
    const result = validateAction("github.sync-pr", {
      registryStatusByConnector: { github: "real" },
    });

    // Then: the default containment policy keeps the action non-executable.
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("external_mutation_contained");
    expect(result.connector?.realCapable).toBe(false);
  });
});
