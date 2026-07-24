import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  getOpportunityDetail: vi.fn(),
  updateOpportunity: vi.fn(),
  assignOpportunityOwner: vi.fn(),
  advanceOpportunityStage: vi.fn(),
  convertOpportunityToProject: vi.fn(),
  addOpportunityLink: vi.fn(),
  removeOpportunityLink: vi.fn(),
  archiveOpportunity: vi.fn(),
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
    getOpportunityDetail: mocks.getOpportunityDetail,
    updateOpportunity: mocks.updateOpportunity,
    assignOpportunityOwner: mocks.assignOpportunityOwner,
    advanceOpportunityStage: mocks.advanceOpportunityStage,
    convertOpportunityToProject: mocks.convertOpportunityToProject,
    addOpportunityLink: mocks.addOpportunityLink,
    removeOpportunityLink: mocks.removeOpportunityLink,
    archiveOpportunity: mocks.archiveOpportunity,
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
const ROUTE = { params: Promise.resolve({ id: "opp-a" }) };
const VERSION = "2026-07-24T00:00:00.000Z";

function request(body: unknown, method = "PATCH", key = "opp-action-a") {
  return new Request("http://localhost/api/opportunities/opp-a", {
    method,
    headers: { "content-type": "application/json", "idempotency-key": key },
    body: JSON.stringify(body),
  });
}

describe("GET/PATCH/DELETE /api/opportunities/:id", () => {
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
    mocks.getOpportunityDetail.mockResolvedValue({ id: "opp-a", updatedAt: new Date(VERSION) });
    mocks.updateOpportunity.mockResolvedValue({ id: "opp-a", title: "Updated" });
    mocks.assignOpportunityOwner.mockResolvedValue({
      id: "opp-a",
      ownerAssignmentId: "assignment-new",
      ownershipRevision: 3,
    });
    mocks.convertOpportunityToProject.mockResolvedValue({
      created: true,
      engagement: { id: "engagement-a" },
      absorbed: { proposals: 0, poc: 1, quotes: 0, meetings: 0 },
    });
    mocks.archiveOpportunity.mockResolvedValue({ id: "opp-a", archivedAt: new Date() });
  });

  it("performs one scoped detail read and returns opaque 404", async () => {
    const response = await GET(new Request("http://localhost/api/opportunities/opp-a"), ROUTE);
    expect(response.status).toBe(200);
    expect(mocks.getOpportunityDetail).toHaveBeenCalledWith(SALES, "opp-a");
    mocks.getOpportunityDetail.mockResolvedValueOnce(null);
    expect((await GET(new Request("http://localhost/api/opportunities/foreign"), ROUTE)).status).toBe(404);
  });

  it("keeps owner reassignment isolated on ownershipRevision", async () => {
    const response = await PATCH(request({
      action: "assign_owner",
      ownerAssignmentId: "assignment-new",
      expectedOwnershipRevision: 2,
    }, "PATCH", "owner-a"), ROUTE);
    expect(response.status).toBe(200);
    expect(mocks.assignOpportunityOwner).toHaveBeenCalledWith(SALES, "opp-a", {
      ownerAssignmentId: "assignment-new",
      expectedOwnershipRevision: 2,
      idempotencyKey: "owner-a",
    });
    expect(mocks.updateOpportunity).not.toHaveBeenCalled();
  });

  it("rejects negative/missing owner revision and combined stage mutation", async () => {
    for (const body of [
      { action: "assign_owner", ownerAssignmentId: "assignment-new" },
      { action: "assign_owner", ownerAssignmentId: "assignment-new", expectedOwnershipRevision: -1 },
      { action: "assign_owner", ownerAssignmentId: "assignment-new", expectedOwnershipRevision: 2, stage: "WON" },
    ]) {
      expect((await PATCH(request(body), ROUTE)).status).toBe(422);
    }
    expect(mocks.assignOpportunityOwner).not.toHaveBeenCalled();
  });

  it("passes the exact no-force conversion command and no pre-conversion writer", async () => {
    const response = await PATCH(request({
      action: "convert_to_project",
      expectedUpdatedAt: VERSION,
    }, "PATCH", "convert-a"), ROUTE);
    expect(response.status).toBe(201);
    expect(mocks.convertOpportunityToProject).toHaveBeenCalledWith(SALES, {
      opportunityId: "opp-a",
      expectedUpdatedAt: VERSION,
      idempotencyKey: "convert-a",
    });
    const forced = await PATCH(request({
      action: "convert_to_project",
      expectedUpdatedAt: VERSION,
      force: true,
    }), ROUTE);
    expect(forced.status).toBe(422);
  });

  it("uses expectedUpdatedAt only for a strict domain changes command", async () => {
    const response = await PATCH(request({
      expectedUpdatedAt: VERSION,
      changes: { title: "Updated" },
    }, "PATCH", "update-a"), ROUTE);
    expect(response.status).toBe(200);
    expect(mocks.updateOpportunity).toHaveBeenCalledWith(SALES, "opp-a", {
      expectedUpdatedAt: VERSION,
      changes: { title: "Updated" },
      idempotencyKey: "update-a",
    });
  });

  it("rejects body scope and archives reversibly with CAS/idempotency", async () => {
    const scoped = await PATCH(request({
      expectedUpdatedAt: VERSION,
      changes: { title: "Updated" },
      projectId: "foreign",
    }), ROUTE);
    expect(scoped.status).toBe(403);

    const archived = await DELETE(request({ expectedUpdatedAt: VERSION }, "DELETE", "archive-a"), ROUTE);
    expect(archived.status).toBe(200);
    expect(mocks.archiveOpportunity).toHaveBeenCalledWith(SALES, "opp-a", {
      expectedUpdatedAt: VERSION,
      idempotencyKey: "archive-a",
    });
  });
});
