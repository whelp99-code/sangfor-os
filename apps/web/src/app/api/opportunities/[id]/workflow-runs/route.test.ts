import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST, GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  startDealWorkflowRun: vi.fn(async () => ({ runId: "run1", definitionKey: "deal-execution.v1", gates: [] })),
  evaluateDealWorkflowGates: vi.fn(async () => ({ opportunityId: "opp1", gates: [] })),
  resolveCrmAuthContext: vi.fn(async () => ({
    userId: "u1", sessionId: "s1", tenantId: "t1", companyId: "c1", projectId: "p1",
    businessRole: "sales_manager", permissions: [], product: "portal",
  })),
  DealWorkflowError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, status = 400) {
      super(message); this.code = code; this.httpStatus = status;
    }
  },
}));

describe("POST & GET /api/opportunities/[id]/workflow-runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts workflow run and returns 201", async () => {
    const req = new NextRequest("http://localhost/api/opportunities/opp1/workflow-runs", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "opp1" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.runId).toBe("run1");
  });

  it("evaluates workflow gates and returns 200", async () => {
    const req = new NextRequest("http://localhost/api/opportunities/opp1/workflow-runs", {
      method: "GET",
    });

    const res = await GET(req, { params: Promise.resolve({ id: "opp1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.opportunityId).toBe("opp1");
  });
});
