import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  getCustomerDetail: vi.fn(),
  updateCustomer: vi.fn(),
  archiveCustomer: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  assertApiAccess: mocks.assertApiAccess,
  apiError: vi.fn((code: string, _error: unknown, options?: { status?: number; message?: string }) =>
    Response.json({ error: code, ...(options?.message ? { message: options.message } : {}) }, { status: options?.status ?? 500 }),
  ),
}));
vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: mocks.evaluateSession,
}));
vi.mock("@/lib/project-scope", () => ({
  resolveProjectScope: vi.fn(() => {
    throw new Error("legacy resolveProjectScope must not be called");
  }),
  isResourceInProject: vi.fn(() => {
    throw new Error("post-fetch scope checks must not be called");
  }),
}));
vi.mock("@sangfor/business", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/business")>();
  return {
    ...actual,
    resolveCrmAuthContext: mocks.resolveContext,
    getCustomerDetail: mocks.getCustomerDetail,
    updateCustomer: mocks.updateCustomer,
    archiveCustomer: mocks.archiveCustomer,
  };
});

import { DELETE, GET, PATCH } from "./route";

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
const CONTEXT = { params: Promise.resolve({ id: "customer-a" }) };

describe("GET/PATCH/DELETE /api/customers/:id", () => {
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
    mocks.getCustomerDetail.mockResolvedValue({
      id: "customer-a",
      projectId: SALES.projectId,
      name: "Customer A",
      updatedAt: new Date("2026-07-24T00:00:00.000Z"),
    });
    mocks.updateCustomer.mockResolvedValue({
      id: "customer-a",
      name: "Customer A2",
      updatedAt: new Date("2026-07-24T00:00:01.000Z"),
    });
    mocks.archiveCustomer.mockResolvedValue({
      id: "customer-a",
      status: "archived",
      archivedAt: new Date("2026-07-24T00:00:01.000Z"),
    });
  });

  it("performs one canonical scoped detail read and returns opaque 404 for null", async () => {
    const request = new Request("http://localhost/api/customers/customer-a");
    const response = await GET(request, CONTEXT);

    expect(response.status).toBe(200);
    expect(mocks.resolveContext).toHaveBeenCalledTimes(1);
    expect(mocks.getCustomerDetail).toHaveBeenCalledWith(SALES, "customer-a");

    mocks.getCustomerDetail.mockResolvedValueOnce(null);
    const foreign = await GET(request, CONTEXT);
    expect(foreign.status).toBe(404);
  });

  it("requires exact PATCH {expectedUpdatedAt,changes} plus Idempotency-Key", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/customers/customer-a", {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "idempotency-key": " customer-update-a ",
        },
        body: JSON.stringify({
          expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
          changes: { name: "Customer A2", status: "inactive" },
        }),
      }),
      CONTEXT,
    );

    expect(response.status).toBe(200);
    expect(mocks.updateCustomer).toHaveBeenCalledWith(SALES, "customer-a", {
      expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
      idempotencyKey: "customer-update-a",
      changes: { name: "Customer A2", status: "inactive" },
    });
  });

  it("rejects scope/actor/owner fields and an empty changes object before mutation", async () => {
    for (const body of [
      {
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        changes: { name: "Customer A2" },
        projectId: "foreign",
      },
      {
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        changes: { ownerAssignmentId: "caller" },
      },
      {
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        changes: {},
      },
    ]) {
      const response = await PATCH(
        new Request("http://localhost/api/customers/customer-a", {
          method: "PATCH",
          headers: { "content-type": "application/json", "idempotency-key": "invalid-update" },
          body: JSON.stringify(body),
        }),
        CONTEXT,
      );
      expect([403, 422]).toContain(response.status);
    }
    expect(mocks.updateCustomer).not.toHaveBeenCalled();
  });

  it("archives reversibly with exact expectedUpdatedAt and maps a stale loser to 409", async () => {
    const request = () =>
      new Request("http://localhost/api/customers/customer-a", {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "idempotency-key": "customer-archive-a",
        },
        body: JSON.stringify({ expectedUpdatedAt: "2026-07-24T00:00:00.000Z" }),
      });

    const response = await DELETE(request(), CONTEXT);
    expect(response.status).toBe(200);
    expect(mocks.archiveCustomer).toHaveBeenCalledWith(SALES, "customer-a", {
      expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
      idempotencyKey: "customer-archive-a",
    });

    const error = Object.assign(new Error("customer changed"), {
      name: "CrmServiceError",
      code: "CONFLICT",
      httpStatus: 409,
    });
    mocks.archiveCustomer.mockRejectedValueOnce(error);
    const stale = await DELETE(request(), CONTEXT);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual(expect.objectContaining({ error: "CONFLICT" }));
  });
});
