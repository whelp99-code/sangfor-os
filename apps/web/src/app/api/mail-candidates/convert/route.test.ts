import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  convert: vi.fn(),
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
  resolveOpportunityAuthContext: mocks.resolveContext,
  convertApprovedMailCandidates: mocks.convert,
}));

import { POST } from "./route";

const SALES: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.write", "opportunity.write"],
  product: "portal",
};
const REF = {
  id: "candidate-1",
  expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
};

function request(body: unknown, key = "convert-batch-1") {
  const headers = new Headers({ "content-type": "application/json" });
  if (key) headers.set("idempotency-key", key);
  return new Request("http://localhost/api/mail-candidates/convert", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.evaluateSession.mockResolvedValue({
    ok: true,
    userId: SALES.userId,
    tenantId: SALES.tenantId,
    companyId: SALES.companyId,
    projectId: SALES.projectId,
  });
  mocks.resolveContext.mockResolvedValue(SALES);
  mocks.convert.mockResolvedValue({
    customersCreated: 1,
    items: [{ candidateId: "candidate-1", entityId: "customer-1" }],
  });
});

describe("POST /api/mail-candidates/convert", () => {
  it("forwards exact candidate versions and header key to the canonical coordinator", async () => {
    const response = await POST(request({ candidates: [REF] }));

    expect(response.status).toBe(200);
    expect(mocks.convert).toHaveBeenCalledWith(SALES, {
      candidates: [REF],
      idempotencyKey: "convert-batch-1",
    });
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ success: true, customersCreated: 1 }),
    );
  });

  it("rejects duplicates, caller authority, unknown fields, and a missing key", async () => {
    const duplicate = await POST(request({ candidates: [REF, REF] }));
    const scope = await POST(
      request({ candidates: [REF], actor: "caller-actor" }),
    );
    const candidateScope = await POST(
      request({
        candidates: [{ ...REF, projectId: "attacker-project" }],
      }),
    );
    const missingKey = await POST(request({ candidates: [REF] }, ""));

    expect(duplicate.status).toBe(422);
    expect(scope.status).toBe(403);
    expect(candidateScope.status).toBe(422);
    expect(missingKey.status).toBe(422);
    expect(mocks.convert).not.toHaveBeenCalled();
  });
});
