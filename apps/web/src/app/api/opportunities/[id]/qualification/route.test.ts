import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  qualifyOpportunity: vi.fn(),
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
    qualifyOpportunity: mocks.qualifyOpportunity,
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
  permissions: ["opportunity.read", "opportunity.write"] as any,
  product: "portal",
};

describe("POST /api/opportunities/[id]/qualification", () => {
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
    mocks.qualifyOpportunity.mockResolvedValue({
      id: "qual-1",
      scoringVersion: "bant-tf-v1",
      scoreTotal: 80,
      passed: true,
      revision: 1,
    });
  });

  it("updates qualification with valid payload", async () => {
    const res = await POST(
      new Request("http://localhost/api/opportunities/opp-1/qualification", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "qual-key-1" },
        body: JSON.stringify({
          expectedRevision: 0,
          budgetScore: 20,
          authorityScore: 20,
          needScore: 20,
          timelineScore: 10,
          technicalFitScore: 10,
        }),
      }),
      { params: Promise.resolve({ id: "opp-1" }) },
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.qualification.passed).toBe(true);
  });

  it("rejects forged scoreTotal or scope fields with HTTP 403", async () => {
    const forgedTotalRes = await POST(
      new Request("http://localhost/api/opportunities/opp-1/qualification", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "qual-key-1" },
        body: JSON.stringify({
          budgetScore: 10,
          authorityScore: 10,
          needScore: 10,
          timelineScore: 10,
          technicalFitScore: 10,
          scoreTotal: 100, // Forged total
        }),
      }),
      { params: Promise.resolve({ id: "opp-1" }) },
    );
    expect(forgedTotalRes.status).toBe(403);

    const forgedScopeRes = await POST(
      new Request("http://localhost/api/opportunities/opp-1/qualification", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "qual-key-1" },
        body: JSON.stringify({
          budgetScore: 10,
          authorityScore: 10,
          needScore: 10,
          timelineScore: 10,
          technicalFitScore: 10,
          tenantId: "foreign-tenant", // Forged scope
        }),
      }),
      { params: Promise.resolve({ id: "opp-1" }) },
    );
    expect(forgedScopeRes.status).toBe(403);
  });
});
