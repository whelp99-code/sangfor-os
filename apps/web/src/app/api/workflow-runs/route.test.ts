import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), list: vi.fn() }));
vi.mock("@sangfor/auth", () => ({ PRIVILEGED_MFA_MAX_AGE_SECONDS: 900, verifySessionJwt: vi.fn(() => ({ jti: "session-1" })) }));
vi.mock("@sangfor/business", () => ({ WorkflowRuntimeError: class WorkflowRuntimeError extends Error {}, startWorkflowRun: mocks.start, listWorkflowRuns: mocks.list }));
vi.mock("@/lib/api-auth", () => ({ assertApiAccess: () => null }));
vi.mock("@/lib/auth/config", () => ({ getWebSessionJwtConfig: () => ({}) }));
vi.mock("@/lib/auth/session", () => ({ extractSessionToken: () => "token" }));
vi.mock("@/lib/auth/persisted-session", () => ({ evaluatePersistedSessionFromClaims: vi.fn(async () => ({ ok: true, userId: "user-1", tenantId: "tenant-1", companyId: "company-1", projectId: "project-1", mfaVerifiedAt: new Date() })) }));

import { POST } from "./route";

describe("POST /api/workflow-runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exists as the canonical persisted-run start entry point", () => {
    expect(POST).toBeTypeOf("function");
  });

  it("rejects body scope, actor, and status injection before a persisted start", async () => {
    for (const body of [
      { workflowDefinitionId: "def", idempotencyKey: "key", input: {}, tenantId: "forged" },
      { workflowDefinitionId: "def", idempotencyKey: "key", input: {}, approvedBy: "forged" },
      { workflowDefinitionId: "def", idempotencyKey: "key", input: {}, status: "running" },
    ]) {
      const response = await POST(new Request("http://localhost/api/workflow-runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      expect([400, 403, 422]).toContain(response.status);
    }
    expect(mocks.start).not.toHaveBeenCalled();
  });
});
