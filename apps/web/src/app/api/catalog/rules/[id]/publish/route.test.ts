import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as publishRule } from "./route";

vi.mock("@/lib/api-auth", () => ({
  assertApiAccess: () => null,
}));

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: async () => ({
    ok: true,
    userId: "user-1",
    tenantId: "tenant-1",
    companyId: "company-1",
    projectId: "project-1",
  }),
}));

const { MockCatalogRuleServiceError } = vi.hoisted(() => {
  class MockCatalogRuleServiceError extends Error {
    code: string;
    httpStatus: number;
    constructor(code: string, message: string) {
      super(message);
      this.name = "CatalogRuleServiceError";
      this.code = code;
      this.httpStatus = code === "STALE_REVISION" ? 409 : code === "FORBIDDEN" ? 403 : 400;
    }
  }
  return { MockCatalogRuleServiceError };
});

vi.mock("@sangfor/business", () => {
  return {
    resolveCrmAuthContext: async () => ({
      userId: "user-1",
      sessionId: "session-1",
      tenantId: "tenant-1",
      companyId: "company-1",
      projectId: "project-1",
    }),
    CatalogRuleServiceError: MockCatalogRuleServiceError,
    publishSizingTemplate: vi.fn().mockImplementation(async (_caller, templateId, input) => {
      if (input.approvalId === "app-409") {
        throw new MockCatalogRuleServiceError("STALE_REVISION", "activeArtifactVersionId CAS mismatch");
      }
      if (input.approvalId === "app-403") {
        throw new MockCatalogRuleServiceError("FORBIDDEN", "Permission denied: required capability 'catalog.write'");
      }
      return {
        templateId,
        publishedArtifactVersionId: input.artifactVersionId,
        approvalId: input.approvalId,
        status: "ACTIVE",
      };
    }),
    publishCompatibilityRule: vi.fn(),
  };
});

describe("/api/catalog/rules/[id]/publish Route Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes sizing template successfully (200 / ok: true)", async () => {
    const req = new Request("http://localhost/api/catalog/rules/st-1/publish", {
      method: "POST",
      body: JSON.stringify({
        type: "sizing",
        artifactVersionId: "ver-1",
        approvalId: "app-valid",
        expectedActiveArtifactVersionId: null,
      }),
    });

    const res = await publishRule(req, { params: Promise.resolve({ id: "st-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.result.status).toBe("ACTIVE");
  });

  it("rejects caller action field injection (422)", async () => {
    const req = new Request("http://localhost/api/catalog/rules/st-1/publish", {
      method: "POST",
      body: JSON.stringify({
        type: "sizing",
        artifactVersionId: "ver-1",
        approvalId: "app-valid",
        action: "catalog.sizing.publish", // Action field tampering attempt!
      }),
    });

    const res = await publishRule(req, { params: Promise.resolve({ id: "st-1" }) });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe("ACTION_INJECTION_FORBIDDEN");
  });

  it("rejects unknown keys in body (422)", async () => {
    const req = new Request("http://localhost/api/catalog/rules/st-1/publish", {
      method: "POST",
      body: JSON.stringify({
        type: "sizing",
        artifactVersionId: "ver-1",
        approvalId: "app-valid",
        maliciousKey: "hacked",
      }),
    });

    const res = await publishRule(req, { params: Promise.resolve({ id: "st-1" }) });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe("UNKNOWN_KEYS_FORBIDDEN");
  });

  it("returns 409 status on stale CAS mismatch approval", async () => {
    const req = new Request("http://localhost/api/catalog/rules/st-1/publish", {
      method: "POST",
      body: JSON.stringify({
        type: "sizing",
        artifactVersionId: "ver-1",
        approvalId: "app-409",
        expectedActiveArtifactVersionId: "ver-old",
      }),
    });

    const res = await publishRule(req, { params: Promise.resolve({ id: "st-1" }) });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.code).toBe("STALE_REVISION");
  });

  it("returns 403 status on permission forbidden approval", async () => {
    const req = new Request("http://localhost/api/catalog/rules/st-1/publish", {
      method: "POST",
      body: JSON.stringify({
        type: "sizing",
        artifactVersionId: "ver-1",
        approvalId: "app-403",
      }),
    });

    const res = await publishRule(req, { params: Promise.resolve({ id: "st-1" }) });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("FORBIDDEN");
  });
});
