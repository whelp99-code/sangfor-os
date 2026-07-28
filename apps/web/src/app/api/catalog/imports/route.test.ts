import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  importCatalogPayload: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  assertApiAccess: mocks.assertApiAccess,
  apiError: vi.fn((code: string, _error: unknown, options?: { status?: number }) =>
    Response.json({ error: code }, { status: options?.status ?? 500 }),
  ),
}));
vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: mocks.evaluateSession,
}));
vi.mock("@sangfor/business", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/business")>();
  return {
    ...actual,
    resolveCrmAuthContext: mocks.resolveContext,
    importCatalogPayload: mocks.importCatalogPayload,
  };
});

import { POST } from "./route";

const WRITER: AuthContext = {
  userId: "user-writer-1",
  sessionId: "session-writer-1",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["catalog.read", "catalog.write", "catalog.cost.read"] as any,
  product: "portal",
};

describe("POST /api/catalog/imports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluateSession.mockResolvedValue({
      ok: true,
      userId: WRITER.userId,
      tenantId: WRITER.tenantId,
      companyId: WRITER.companyId,
      projectId: WRITER.projectId,
    });
    mocks.resolveContext.mockResolvedValue(WRITER);
    mocks.importCatalogPayload.mockResolvedValue({ created: true, dryRun: false });
  });

  it("handles catalog import and dryRun parameter", async () => {
    const payload = {
      familyKey: "fam-1",
      vendorKey: "v1",
      vendor: "Vendor 1",
      name: "Family 1",
      editions: [],
      metrics: [],
    };

    const res = await POST(
      new Request("http://localhost/api/catalog/imports?dryRun=true", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "import-key" },
        body: JSON.stringify({ payload }),
      }),
    );
    expect(res.status).toBe(200);

    const forbiddenRes = await POST(
      new Request("http://localhost/api/catalog/imports", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "import-key" },
        body: JSON.stringify({ payload, companyId: "foreign" }),
      }),
    );
    expect(forbiddenRes.status).toBe(403);
  });
});
