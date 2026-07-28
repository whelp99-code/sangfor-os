import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  getQuoteDetail: vi.fn(),
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
    getQuoteDetail: mocks.getQuoteDetail,
  };
});

import { GET } from "./route";

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

describe("GET /api/quotes/[id]", () => {
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
  });

  it("returns quote detail via getQuoteDetail service", async () => {
    const mockQuote = {
      id: "quote-1",
      opportunityId: "opp-1",
      version: 1,
      status: "draft",
      lineItems: [],
      commercialSnapshot: null,
      artifactVersion: null,
    };
    mocks.getQuoteDetail.mockResolvedValue(mockQuote);

    const res = await GET(
      new Request("http://localhost/api/quotes/quote-1", { method: "GET" }),
      { params: Promise.resolve({ id: "quote-1" }) }
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.quote.id).toBe("quote-1");
    expect(mocks.getQuoteDetail).toHaveBeenCalledWith(WRITER, "quote-1");
  });

  it("returns 404 when quote not found", async () => {
    const { QuoteServiceError } = await import("@sangfor/business");
    mocks.getQuoteDetail.mockRejectedValue(
      new QuoteServiceError("NOT_FOUND", "Quote not found", 404)
    );

    const res = await GET(
      new Request("http://localhost/api/quotes/quote-notfound", { method: "GET" }),
      { params: Promise.resolve({ id: "quote-notfound" }) }
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND" });
  });

  it("handles authorization error gracefully", async () => {
    mocks.evaluateSession.mockResolvedValueOnce({ ok: false });

    const res = await GET(
      new Request("http://localhost/api/quotes/quote-1", { method: "GET" }),
      { params: Promise.resolve({ id: "quote-1" }) }
    );
    expect(res.status).toBe(401);
  });

  it("returns 500 for unexpected errors", async () => {
    mocks.getQuoteDetail.mockRejectedValue(new Error("unexpected"));

    const res = await GET(
      new Request("http://localhost/api/quotes/quote-1", { method: "GET" }),
      { params: Promise.resolve({ id: "quote-1" }) }
    );
    expect(res.status).toBe(500);
  });
});
