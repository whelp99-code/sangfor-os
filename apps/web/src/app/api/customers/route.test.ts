import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  listCustomers: vi.fn(),
  createCustomer: vi.fn(),
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
    listCustomers: mocks.listCustomers,
    createCustomer: mocks.createCustomer,
  };
});

import { GET, POST } from "./route";

const SALES: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write", "quote.read", "quote.write", "quote.approve_discount"],
  product: "portal",
};

describe("GET/POST /api/customers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluateSession.mockResolvedValue({
      ok: true,
      userId: SALES.userId,
      tenantId: SALES.tenantId,
      companyId: SALES.companyId,
      projectId: SALES.projectId,
      mfaVerifiedAt: null,
    });
    mocks.resolveContext.mockResolvedValue(SALES);
    mocks.listCustomers.mockResolvedValue({ items: [], nextCursor: null });
    mocks.createCustomer.mockResolvedValue({
      id: "customer-a",
      projectId: SALES.projectId,
      name: "Customer A",
    });
  });

  it("derives one canonical AuthContext and forwards only pagination filters", async () => {
    const response = await GET(
      new Request("http://localhost/api/customers?q=acme&domain=acme.example&first=25"),
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveContext).toHaveBeenCalledTimes(1);
    expect(mocks.listCustomers).toHaveBeenCalledWith(SALES, {
      search: "acme",
      domain: "acme.example",
      first: 25,
      cursor: undefined,
    });
    await expect(response.json()).resolves.toEqual({ customers: [], nextCursor: null });
  });

  it("requires a bounded Idempotency-Key and never forwards caller scope", async () => {
    const response = await POST(
      new Request("http://localhost/api/customers", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": " create-customer-a ",
        },
        body: JSON.stringify({
          name: "Customer A",
          domain: "customer.example",
          industry: "IT",
          notes: "Scoped",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createCustomer).toHaveBeenCalledWith(SALES, {
      name: "Customer A",
      domain: "customer.example",
      industry: "IT",
      notes: "Scoped",
      idempotencyKey: "create-customer-a",
    });
  });

  it.each([
    "tenantId",
    "companyId",
    "projectId",
    "projectSlug",
    "actor",
    "assignmentId",
    "role",
  ])("rejects caller-selected %s before the service", async (field) => {
    const response = await POST(
      new Request("http://localhost/api/customers", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "scope-reject" },
        body: JSON.stringify({ name: "Customer A", [field]: "caller-value" }),
      }),
    );

    expect(response.status).toBe(field === "tenantId" || field === "companyId" || field === "projectId" || field === "projectSlug" ? 403 : 422);
    expect(mocks.createCustomer).not.toHaveBeenCalled();
  });

  it("rejects a missing, empty, control-bearing, or overlong key", async () => {
    // Fetch rejects control-bearing header values before a Request can reach the route.
    expect(() => new Headers({ "idempotency-key": "bad\nkey" })).toThrow();

    for (const key of [undefined, "", "x".repeat(129)]) {
      const headers = new Headers({ "content-type": "application/json" });
      if (key !== undefined) headers.set("idempotency-key", key);
      const response = await POST(
        new Request("http://localhost/api/customers", {
          method: "POST",
          headers,
          body: JSON.stringify({ name: "Customer A" }),
        }),
      );
      expect(response.status).toBe(422);
    }
    expect(mocks.createCustomer).not.toHaveBeenCalled();
  });
});
