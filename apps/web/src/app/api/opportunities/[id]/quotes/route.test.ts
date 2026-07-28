import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  createQuoteVersion: vi.fn(),
  listQuoteVersions: vi.fn(),
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
    createQuoteVersion: mocks.createQuoteVersion,
    listQuoteVersions: mocks.listQuoteVersions,
  };
});

import { POST, GET } from "./route";

const WRITER: AuthContext = {
  userId: "user-writer-1",
  sessionId: "session-writer-1",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["opportunity.read", "opportunity.write"] as any,
  product: "portal",
};

describe("POST /api/opportunities/[id]/quotes", () => {
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
    mocks.createQuoteVersion.mockResolvedValue({
      id: "quote-1",
      opportunityId: "opp-1",
      version: 1,
      status: "draft",
      totalRevenue: "10000.00",
      totalCost: "5000.00",
      marginPct: "50.00",
      currency: "USD",
      lineItems: [],
      commercialSnapshot: {
        quoteId: "quote-1",
        policyVersion: "v1",
        calculatedRevenue: "10000.00",
        calculatedCost: "5000.00",
        calculatedMarginPct: "50.00",
        costCoverageStatus: "complete",
        requiresApproval: false,
      },
    });
  });

  it("creates quote with valid payload", async () => {
    const res = await POST(
      new Request(
        "http://localhost/api/opportunities/opp-1/quotes",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            currency: "USD",
            lines: [
              {
                lineType: "service",
                quantity: 2,
                unitPrice: 5000,
                discountPct: 0,
              },
            ],
          }),
        }
      ),
      { params: Promise.resolve({ id: "opp-1" }) }
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.quote.id).toBe("quote-1");
    expect(mocks.createQuoteVersion).toHaveBeenCalledWith(
      WRITER,
      expect.objectContaining({
        opportunityId: "opp-1",
        currency: "USD",
        lines: expect.any(Array),
      })
    );
  });

  it("rejects scope fields with HTTP 403", async () => {
    const res = await POST(
      new Request(
        "http://localhost/api/opportunities/opp-1/quotes",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            currency: "USD",
            lines: [{ lineType: "service", quantity: 1, unitPrice: 1000 }],
            tenantId: "foreign-tenant",
          }),
        }
      ),
      { params: Promise.resolve({ id: "opp-1" }) }
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN_SCOPE" });
    expect(mocks.createQuoteVersion).not.toHaveBeenCalled();
  });

  it("rejects forged money fields with HTTP 403 and does not call service", async () => {
    const res = await POST(
      new Request(
        "http://localhost/api/opportunities/opp-1/quotes",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            currency: "USD",
            lines: [{ lineType: "service", quantity: 1, unitPrice: 1000 }],
            totalRevenue: "999999.00",
          }),
        }
      ),
      { params: Promise.resolve({ id: "opp-1" }) }
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "FORBIDDEN_FORGED_FIELD" });
    expect(mocks.createQuoteVersion).not.toHaveBeenCalled();
  });

  it("propagates service error with matching httpStatus", async () => {
    const { QuoteServiceError } = await import("@sangfor/business");
    mocks.createQuoteVersion.mockRejectedValueOnce(
      new QuoteServiceError("STALE_CAS", "Content hash mismatch", 409)
    );

    const res = await POST(
      new Request(
        "http://localhost/api/opportunities/opp-1/quotes",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            currency: "USD",
            lines: [{ lineType: "service", quantity: 1, unitPrice: 1000 }],
          }),
        }
      ),
      { params: Promise.resolve({ id: "opp-1" }) }
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "STALE_CAS" });
  });
});

describe("GET /api/opportunities/[id]/quotes", () => {
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
    mocks.listQuoteVersions.mockResolvedValue([]);
  });

  it("returns quotes list via listQuoteVersions service", async () => {
    const mockQuotes = [
      { id: "quote-1", version: 1, status: "draft", commercialSnapshot: null },
      { id: "quote-2", version: 2, status: "draft", commercialSnapshot: null },
    ];
    mocks.listQuoteVersions.mockResolvedValue(mockQuotes);

    const res = await GET(
      new Request("http://localhost/api/opportunities/opp-1/quotes", {
        method: "GET",
      }),
      { params: Promise.resolve({ id: "opp-1" }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.quotes).toHaveLength(2);
    expect(mocks.listQuoteVersions).toHaveBeenCalledWith(WRITER, "opp-1", { first: undefined });
  });

  it("passes first parameter to listQuoteVersions", async () => {
    mocks.listQuoteVersions.mockResolvedValue([]);

    const res = await GET(
      new Request("http://localhost/api/opportunities/opp-1/quotes?first=10", {
        method: "GET",
      }),
      { params: Promise.resolve({ id: "opp-1" }) }
    );
    expect(res.status).toBe(200);
    expect(mocks.listQuoteVersions).toHaveBeenCalledWith(WRITER, "opp-1", { first: 10 });
  });

  it("returns empty list for valid opportunity", async () => {
    mocks.listQuoteVersions.mockResolvedValue([]);

    const res = await GET(
      new Request("http://localhost/api/opportunities/opp-valid/quotes", {
        method: "GET",
      }),
      { params: Promise.resolve({ id: "opp-valid" }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.quotes).toEqual([]);
  });

  it("rejects invalid pagination parameters with HTTP 422", async () => {
    const res = await GET(
      new Request("http://localhost/api/opportunities/opp-1/quotes?first=invalid", {
        method: "GET",
      }),
      { params: Promise.resolve({ id: "opp-1" }) }
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "VALIDATION_ERROR" });
  });

  it("rejects unknown query parameters with HTTP 422", async () => {
    const res = await GET(
      new Request("http://localhost/api/opportunities/opp-1/quotes?unknown=value", {
        method: "GET",
      }),
      { params: Promise.resolve({ id: "opp-1" }) }
    );
    expect(res.status).toBe(422);
  });

  it("propagates service error for non-existent opportunity", async () => {
    const { QuoteServiceError } = await import("@sangfor/business");
    mocks.listQuoteVersions.mockRejectedValue(
      new QuoteServiceError("NOT_FOUND", "Opportunity not found", 404)
    );

    const res = await GET(
      new Request("http://localhost/api/opportunities/opp-missing/quotes", {
        method: "GET",
      }),
      { params: Promise.resolve({ id: "opp-missing" }) }
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
  });
});
