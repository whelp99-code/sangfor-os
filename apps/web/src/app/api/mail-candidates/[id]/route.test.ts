import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  approve: vi.fn(),
  executeManual: vi.fn(),
  getScoped: vi.fn(),
  revalidate: vi.fn(),
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
vi.mock("@sangfor/business", () => ({
  resolveCrmAuthContext: mocks.resolveContext,
}));
vi.mock("@sangfor/business/mail-candidates", () => ({
  approveMailDerivedCandidate: mocks.approve,
  executeScopedMailCandidateManualCommand: mocks.executeManual,
  getScopedMailDerivedCandidate: mocks.getScoped,
  revalidateMailDerivedCandidate: mocks.revalidate,
}));

import { GET, PATCH } from "./route";

const SALES: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write"],
  product: "portal",
};

function request(
  body?: unknown,
  key = "mail-candidate-command-1",
  method = "PATCH",
) {
  const headers = new Headers();
  if (body !== undefined) headers.set("content-type", "application/json");
  if (key) headers.set("idempotency-key", key);
  return new Request("http://localhost/api/mail-candidates/candidate-1", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function params(id = "candidate-1") {
  return { params: Promise.resolve({ id }) };
}

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
  mocks.getScoped.mockResolvedValue({
    id: "candidate-1",
    status: "approved",
    updatedAt: new Date("2026-07-24T00:00:00.000Z"),
  });
  mocks.approve.mockResolvedValue({
    items: [{ candidateId: "candidate-1", entityId: "customer-1" }],
  });
  mocks.revalidate.mockResolvedValue({
    candidate: { id: "candidate-1" },
    revalidation: { decision: "needs_human_review" },
  });
  mocks.executeManual.mockResolvedValue({
    id: "candidate-1",
    status: "rejected",
    updatedAt: new Date("2026-07-24T00:00:01.000Z"),
  });
});

describe("GET/PATCH /api/mail-candidates/[id]", () => {
  it("reads one candidate through authenticated scoped authority", async () => {
    const response = await GET(request(undefined, "", "GET"), params());

    expect(response.status).toBe(200);
    expect(mocks.getScoped).toHaveBeenCalledWith(SALES, "candidate-1");
  });

  it("returns an opaque 404 for a candidate outside the scoped read", async () => {
    mocks.getScoped.mockResolvedValueOnce(null);

    const response = await GET(request(undefined, "", "GET"), params("foreign"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "not_found" });
  });

  it("delegates exact approve version and header idempotency with AuthContext", async () => {
    const response = await PATCH(
      request({
        action: "approve",
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(mocks.approve).toHaveBeenCalledWith(SALES, "candidate-1", {
      expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
      idempotencyKey: "mail-candidate-command-1",
    });
  });

  it("delegates non-forced revalidation with the same strict CAS/idempotency contract", async () => {
    const response = await PATCH(
      request({
        action: "revalidate",
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(mocks.revalidate).toHaveBeenCalledWith(SALES, "candidate-1", {
      expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
      idempotencyKey: "mail-candidate-command-1",
      force: false,
    });
  });

  it("delegates forced revalidation", async () => {
    const response = await PATCH(
      request({
        action: "revalidate",
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        force: true,
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(mocks.revalidate).toHaveBeenCalledWith(SALES, "candidate-1", {
      expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
      idempotencyKey: "mail-candidate-command-1",
      force: true,
    });
  });

  it.each([
    {
      body: {
        action: "reject",
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        reasonCode: "weak_evidence",
      },
    },
    {
      body: {
        action: "set_candidate_type",
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        candidateType: "partner",
      },
    },
  ])("delegates $body.action through the scoped manual command", async ({ body }) => {
    const response = await PATCH(request(body), params());

    expect(response.status).toBe(200);
    expect(mocks.executeManual).toHaveBeenCalledWith(SALES, "candidate-1", {
      ...body,
      idempotencyKey: "mail-candidate-command-1",
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
  ])("rejects caller-selected %s before a command", async (field) => {
    const response = await PATCH(
      request({
        action: "approve",
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        [field]: "caller-value",
      }),
      params(),
    );

    expect(response.status).toBe(403);
    expect(mocks.approve).not.toHaveBeenCalled();
  });

  it("rejects a missing key, unknown action, and missing expected version", async () => {
    const missingKey = await PATCH(
      request(
        {
          action: "approve",
          expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        },
        "",
      ),
      params(),
    );
    const unknownAction = await PATCH(
      request({ action: "delete", expectedUpdatedAt: "2026-07-24T00:00:00.000Z" }),
      params(),
    );
    const missingVersion = await PATCH(
      request({ action: "set_candidate_type", candidateType: "partner" }),
      params(),
    );

    expect(missingKey.status).toBe(422);
    expect(unknownAction.status).toBe(422);
    expect(missingVersion.status).toBe(422);
    expect(mocks.approve).not.toHaveBeenCalled();
  });
});
