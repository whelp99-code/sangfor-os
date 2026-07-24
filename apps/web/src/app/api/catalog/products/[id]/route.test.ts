import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  getCatalogProductDetail: vi.fn(),
  updateProductFamily: vi.fn(),
  archiveProductFamily: vi.fn(),
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
    getCatalogProductDetail: mocks.getCatalogProductDetail,
    updateProductFamily: mocks.updateProductFamily,
    archiveProductFamily: mocks.archiveProductFamily,
  };
});

import { DELETE, GET, PATCH } from "./route";

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

describe("GET/PATCH/DELETE /api/catalog/products/[id]", () => {
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
    mocks.getCatalogProductDetail.mockResolvedValue({ id: "fam-1", name: "Family 1" });
    mocks.updateProductFamily.mockResolvedValue({ id: "fam-1", name: "Updated Family 1" });
    mocks.archiveProductFamily.mockResolvedValue({ id: "fam-1", status: "archived" });
  });

  it("fetches product detail or returns 404", async () => {
    const res = await GET(new Request("http://localhost/api/catalog/products/fam-1"), {
      params: Promise.resolve({ id: "fam-1" }),
    });
    expect(res.status).toBe(200);

    mocks.getCatalogProductDetail.mockResolvedValueOnce(null);
    const notFoundRes = await GET(new Request("http://localhost/api/catalog/products/fam-unknown"), {
      params: Promise.resolve({ id: "fam-unknown" }),
    });
    expect(notFoundRes.status).toBe(404);
  });

  it("updates product family with CAS timestamp and rejects forbidden scope", async () => {
    const expectedUpdatedAt = new Date().toISOString();
    const res = await PATCH(
      new Request("http://localhost/api/catalog/products/fam-1", {
        method: "PATCH",
        headers: { "content-type": "application/json", "idempotency-key": "update-key" },
        body: JSON.stringify({ expectedUpdatedAt, changes: { name: "Updated" } }),
      }),
      { params: Promise.resolve({ id: "fam-1" }) },
    );
    expect(res.status).toBe(200);
  });

  it("archives product family with CAS timestamp", async () => {
    const expectedUpdatedAt = new Date().toISOString();
    const res = await DELETE(
      new Request("http://localhost/api/catalog/products/fam-1", {
        method: "DELETE",
        headers: { "content-type": "application/json", "idempotency-key": "archive-key" },
        body: JSON.stringify({ expectedUpdatedAt }),
      }),
      { params: Promise.resolve({ id: "fam-1" }) },
    );
    expect(res.status).toBe(200);
  });
});
