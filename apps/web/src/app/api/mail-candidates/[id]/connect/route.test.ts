import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  approveAndConnect: vi.fn(),
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
vi.mock("@sangfor/business/mail-candidate-connections", () => ({
  approveAndConnectMailCandidate: mocks.approveAndConnect,
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

function request(body: unknown, key = "connect-candidate-1") {
  const headers = new Headers({ "content-type": "application/json" });
  if (key) headers.set("idempotency-key", key);
  return new Request("http://localhost/api/mail-candidates/candidate-1/connect", {
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
  mocks.approveAndConnect.mockResolvedValue({
    items: [
      {
        candidateId: "candidate-1",
        entityType: "opportunity",
        entityId: "opportunity-1",
        created: true,
      },
    ],
  });
});

describe("POST /api/mail-candidates/[id]/connect", () => {
  it("delegates one exact versioned candidate through canonical context", async () => {
    const response = await POST(
      request({ expectedUpdatedAt: "2026-07-24T00:00:00.000Z" }),
      { params: Promise.resolve({ id: "candidate-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.approveAndConnect).toHaveBeenCalledWith(SALES, {
      candidateId: "candidate-1",
      expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
      idempotencyKey: "connect-candidate-1",
    });
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ redirectTo: "/deals/opportunity-1" }),
    );
  });

  it("rejects missing key, unknown fields, and caller scope before conversion", async () => {
    const missingKey = await POST(
      request({ expectedUpdatedAt: "2026-07-24T00:00:00.000Z" }, ""),
      { params: Promise.resolve({ id: "candidate-1" }) },
    );
    const legacyPayload = await POST(
      request({
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        customer: { mode: "create" },
      }),
      { params: Promise.resolve({ id: "candidate-1" }) },
    );
    const scopePayload = await POST(
      request({
        expectedUpdatedAt: "2026-07-24T00:00:00.000Z",
        projectId: "attacker-project",
      }),
      { params: Promise.resolve({ id: "candidate-1" }) },
    );

    expect(missingKey.status).toBe(422);
    expect(legacyPayload.status).toBe(422);
    expect(scopePayload.status).toBe(403);
    expect(mocks.approveAndConnect).not.toHaveBeenCalled();
  });
});
