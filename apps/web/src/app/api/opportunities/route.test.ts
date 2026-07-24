import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  listOpportunities: vi.fn(),
  createOpportunity: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  assertApiAccess: mocks.assertApiAccess,
  apiError: vi.fn((code: string, _error: unknown, options?: { status?: number }) =>
    Response.json({ error: code }, { status: options?.status ?? 500 })),
}));
vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: mocks.evaluateSession,
}));
vi.mock("@sangfor/business", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/business")>();
  return {
    ...actual,
    resolveOpportunityAuthContext: mocks.resolveContext,
    listOpportunities: mocks.listOpportunities,
    createOpportunity: mocks.createOpportunity,
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

describe("GET/POST /api/opportunities", () => {
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
    mocks.listOpportunities.mockResolvedValue({ items: [], nextCursor: "next-a" });
    mocks.createOpportunity.mockResolvedValue({
      id: "opp-a",
      projectId: SALES.projectId,
      title: "Deal A",
      stage: "LEAD",
    });
  });

  it("derives context once and forwards only stable pagination filters", async () => {
    const response = await GET(new Request(
      "http://localhost/api/opportunities?first=25&cursor=opaque&ownerAssignmentId=assignment-a&stage=LEAD&q=acme",
    ));
    expect(response.status).toBe(200);
    expect(mocks.resolveContext).toHaveBeenCalledTimes(1);
    expect(mocks.listOpportunities).toHaveBeenCalledWith(SALES, {
      first: 25,
      cursor: "opaque",
      ownerAssignmentId: "assignment-a",
      stage: "LEAD",
      search: "acme",
    });
    await expect(response.json()).resolves.toEqual({ opportunities: [], nextCursor: "next-a" });
  });

  it("creates at canonical service with a header key and no caller authority", async () => {
    const response = await POST(new Request("http://localhost/api/opportunities", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": " create-opp-a ",
      },
      body: JSON.stringify({
        title: "Deal A",
        customerId: "customer-a",
        probability: 20,
      }),
    }));
    expect(response.status).toBe(201);
    expect(mocks.createOpportunity).toHaveBeenCalledWith(SALES, {
      title: "Deal A",
      customerId: "customer-a",
      probability: 20,
      idempotencyKey: "create-opp-a",
    });
  });

  it.each(["projectSlug", "projectId", "companyId", "tenantId"])(
    "rejects caller-selected %s before create",
    async (field) => {
      const response = await POST(new Request("http://localhost/api/opportunities", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "scope-a" },
        body: JSON.stringify({ title: "Deal A", [field]: "foreign" }),
      }));
      expect(response.status).toBe(403);
      expect(mocks.createOpportunity).not.toHaveBeenCalled();
    },
  );

  it("rejects a caller-selected stage/owner and missing idempotency", async () => {
    for (const body of [
      { title: "Deal A", stage: "WON" },
      { title: "Deal A", ownerAssignmentId: "assignment-a" },
    ]) {
      const response = await POST(new Request("http://localhost/api/opportunities", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "invalid-a" },
        body: JSON.stringify(body),
      }));
      expect(response.status).toBe(422);
    }
    const missing = await POST(new Request("http://localhost/api/opportunities", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Deal A" }),
    }));
    expect(missing.status).toBe(422);
    expect(mocks.createOpportunity).not.toHaveBeenCalled();
  });
});
