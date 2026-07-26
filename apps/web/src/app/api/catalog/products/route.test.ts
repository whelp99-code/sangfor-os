import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  listCatalogProducts: vi.fn(),
  createProductFamily: vi.fn(),
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
vi.mock("@/lib/auth/authorization", () => ({
  resolveBusinessCapabilityContext: mocks.resolveContext,
}));
vi.mock("@sangfor/business", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/business")>();
  return {
    ...actual,
    listCatalogProducts: mocks.listCatalogProducts,
    createProductFamily: mocks.createProductFamily,
  };
});

import { GET, POST } from "./route";

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

describe("GET/POST /api/catalog/products", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluateSession.mockResolvedValue({
      ok: true,
      userId: WRITER.userId,
      tenantId: WRITER.tenantId,
      companyId: WRITER.companyId,
      projectId: WRITER.projectId,
    });
    mocks.resolveContext.mockResolvedValue({ ok: true, context: WRITER });
    mocks.listCatalogProducts.mockResolvedValue({ items: [], nextCursor: null });
    mocks.createProductFamily.mockResolvedValue({ id: "fam-1", name: "Family 1" });
  });

  it("lists catalog products and rejects forbidden scope params", async () => {
    const res = await GET(new Request("http://localhost/api/catalog/products?vendor=Sangfor&first=20"));
    expect(res.status).toBe(200);

    const forbiddenRes = await GET(new Request("http://localhost/api/catalog/products?companyId=other"));
    expect(forbiddenRes.status).toBe(403);
  });

  it("creates a product family and rejects scope fields in body", async () => {
    const res = await POST(
      new Request("http://localhost/api/catalog/products", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "create-fam-key" },
        body: JSON.stringify({ vendor: "Sangfor", name: "NGAF" }),
      }),
    );
    expect(res.status).toBe(201);

    const forbiddenRes = await POST(
      new Request("http://localhost/api/catalog/products", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "create-fam-key" },
        body: JSON.stringify({ vendor: "Sangfor", name: "NGAF", companyId: "other" }),
      }),
    );
    expect(forbiddenRes.status).toBe(403);
  });
});
