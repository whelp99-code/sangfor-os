import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  createCommercialApprovalForQuote: vi.fn(),
  getCommercialApprovalStatus: vi.fn(),
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
    createCommercialApprovalForQuote: mocks.createCommercialApprovalForQuote,
    getCommercialApprovalStatus: mocks.getCommercialApprovalStatus,
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
  permissions: ["opportunity.read", "opportunity.write", "quote.read", "quote.write"] as any,
  product: "portal",
};

describe("POST /api/quotes/[id]/commercial-approval", () => {
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

  it("creates commercial approval for a quote", async () => {
    mocks.createCommercialApprovalForQuote.mockResolvedValue({
      quoteId: "quote-1",
      quoteVersion: 1,
      contentHash: "a".repeat(64),
      artifactVersionId: "av-1",
      decision: {
        revenue: 10000,
        cost: 5000,
        grossMargin: 5000,
        grossMarginPercent: 50,
        decision: "requires_approval",
        blocked: true,
        reasons: ["low_margin"],
        policyKey: "quote.internal_release",
        policyVersion: "v1",
        requiredQuorum: 2,
        requiredRoles: ["finance", "ceo"],
      },
      approvalRequestId: "apr-1",
      approvalStatus: "ready_for_human_approval",
      aiQualityIntegration: "DEFERRED_TO_U055",
    });

    const res = await POST(
      new Request("http://localhost/api/quotes/quote-1/commercial-approval", { method: "POST" }),
      { params: Promise.resolve({ id: "quote-1" }) },
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.result.quoteId).toBe("quote-1");
    expect(data.result.aiQualityIntegration).toBe("DEFERRED_TO_U055");
    expect(mocks.createCommercialApprovalForQuote).toHaveBeenCalledWith(WRITER, "quote-1");
  });

  it("returns 404 for non-existent quote", async () => {
    const { CommercialQuoteApprovalError } = await import("@sangfor/business");
    mocks.createCommercialApprovalForQuote.mockRejectedValue(
      new CommercialQuoteApprovalError("NOT_FOUND", "Quote not found", 404),
    );

    const res = await POST(
      new Request("http://localhost/api/quotes/missing/commercial-approval", { method: "POST" }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 422 for auto_failed cost coverage", async () => {
    const { CommercialQuoteApprovalError } = await import("@sangfor/business");
    mocks.createCommercialApprovalForQuote.mockRejectedValue(
      new CommercialQuoteApprovalError("COST_COVERAGE_AUTO_FAILED", "auto_failed", 422),
    );

    const res = await POST(
      new Request("http://localhost/api/quotes/quote-1/commercial-approval", { method: "POST" }),
      { params: Promise.resolve({ id: "quote-1" }) },
    );
    expect(res.status).toBe(422);
  });

  it("returns 401 for unauthenticated request", async () => {
    mocks.evaluateSession.mockResolvedValueOnce({ ok: false });

    const res = await POST(
      new Request("http://localhost/api/quotes/quote-1/commercial-approval", { method: "POST" }),
      { params: Promise.resolve({ id: "quote-1" }) },
    );
    expect(res.status).toBe(401);
  });
});

describe("GET /api/quotes/[id]/commercial-approval", () => {
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

  it("returns commercial approval status", async () => {
    mocks.getCommercialApprovalStatus.mockResolvedValue({
      quoteId: "quote-1",
      quoteVersion: 1,
      contentHash: "a".repeat(64),
      artifactVersionId: "av-1",
      decision: {
        revenue: 10000,
        cost: 5000,
        grossMargin: 5000,
        grossMarginPercent: 50,
        decision: "allowed",
        blocked: false,
        reasons: [],
        policyKey: "quote.internal_release",
        policyVersion: "v1",
        requiredQuorum: 2,
        requiredRoles: ["finance", "ceo"],
      },
      approvalRequestId: null,
      approvalStatus: null,
      aiQualityIntegration: "DEFERRED_TO_U055",
    });

    const res = await GET(
      new Request("http://localhost/api/quotes/quote-1/commercial-approval", { method: "GET" }),
      { params: Promise.resolve({ id: "quote-1" }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.result.decision.decision).toBe("allowed");
    expect(data.result.aiQualityIntegration).toBe("DEFERRED_TO_U055");
  });

  it("returns 404 for non-existent quote", async () => {
    const { CommercialQuoteApprovalError } = await import("@sangfor/business");
    mocks.getCommercialApprovalStatus.mockRejectedValue(
      new CommercialQuoteApprovalError("NOT_FOUND", "Quote not found", 404),
    );

    const res = await GET(
      new Request("http://localhost/api/quotes/missing/commercial-approval", { method: "GET" }),
      { params: Promise.resolve({ id: "missing" }) },
    );
    expect(res.status).toBe(404);
  });

  it("returns 401 for unauthenticated request", async () => {
    mocks.evaluateSession.mockResolvedValueOnce({ ok: false });

    const res = await GET(
      new Request("http://localhost/api/quotes/quote-1/commercial-approval", { method: "GET" }),
      { params: Promise.resolve({ id: "quote-1" }) },
    );
    expect(res.status).toBe(401);
  });
});
