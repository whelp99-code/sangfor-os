import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as getRuleDetail, PATCH as patchRule } from "./route";

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

const { MockCatalogRuleServiceError, MockRuleEngineError } = vi.hoisted(() => {
  class MockCatalogRuleServiceError extends Error {
    code: string;
    httpStatus: number;
    constructor(code: string, message: string) {
      super(message);
      this.name = "CatalogRuleServiceError";
      this.code = code;
      this.httpStatus = 400;
    }
  }
  class MockRuleEngineError extends Error {
    code: string;
    httpStatus: number;
    constructor(code: string, message: string) {
      super(message);
      this.name = "RuleEngineError";
      this.code = code;
      this.httpStatus = 422;
    }
  }
  return { MockCatalogRuleServiceError, MockRuleEngineError };
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
    RuleEngineError: MockRuleEngineError,
  };
});

vi.mock("@sangfor/db", () => ({
  prisma: {
    sizingTemplate: {
      findUnique: vi.fn().mockImplementation(({ where: { id } }) => {
        if (id === "st-1") {
          return Promise.resolve({
            id: "st-1",
            productFamilyId: "fam-1",
            templateKey: "tmpl-1",
            name: "Original Name",
            artifactId: "art-1",
            revision: 1,
            configJson: { version: "v1" },
            status: "DRAFT",
          });
        }
        return Promise.resolve(null);
      }),
      update: vi.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: "st-1",
          name: data.name,
          configJson: data.configJson,
          revision: 2,
        })
      ),
    },
    compatibilityRule: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    artifactVersion: {
      findFirst: vi.fn().mockResolvedValue({ version: 1 }),
      create: vi.fn().mockResolvedValue({
        id: "ver-new-2",
        artifactId: "art-1",
        version: 2,
      }),
    },
  },
}));

describe("/api/catalog/rules/[id] Route Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads rule detail via GET", async () => {
    const req = new Request("http://localhost/api/catalog/rules/st-1");
    const res = await getRuleDetail(req, { params: Promise.resolve({ id: "st-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.type).toBe("sizing");
    expect(json.rule.id).toBe("st-1");
  });

  it("edits draft and creates new ArtifactVersion via PATCH", async () => {
    const req = new Request("http://localhost/api/catalog/rules/st-1", {
      method: "PATCH",
      body: JSON.stringify({
        type: "sizing",
        name: "Updated Sizing Rule Name",
        configJson: { version: "v1", rules: [] },
      }),
    });

    const res = await patchRule(req, { params: Promise.resolve({ id: "st-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.rule.name).toBe("Updated Sizing Rule Name");
    expect(json.newArtifactVersionId).toBe("ver-new-2");
  });

  it("rejects scope field modification in PATCH body (422)", async () => {
    const req = new Request("http://localhost/api/catalog/rules/st-1", {
      method: "PATCH",
      body: JSON.stringify({
        tenantId: "hacked-tenant",
        name: "Malicious Edit",
      }),
    });

    const res = await patchRule(req, { params: Promise.resolve({ id: "st-1" }) });
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain("Scope modification");
  });
});
