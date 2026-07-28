import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  connect: vi.fn(),
  overview: vi.fn(),
  tasks: vi.fn(),
  sync: vi.fn(),
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
  connectMockOutlook: mocks.connect,
  getPortalOverview: mocks.overview,
  listPortalTasks: mocks.tasks,
  resolveCrmAuthContext: mocks.resolveContext,
  syncMockMail: mocks.sync,
}));

import { GET, POST } from "./route";

const SALES: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "opportunity.read"],
  product: "portal",
};

function postRequest(body: unknown, key = "portal-command-1") {
  const headers = new Headers({ "content-type": "application/json" });
  if (key) headers.set("idempotency-key", key);
  return new Request("http://localhost/api/portal", {
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
  mocks.overview.mockResolvedValue({ accounts: 1, messages: 2, tasks: 3 });
  mocks.tasks.mockResolvedValue([]);
  mocks.connect.mockResolvedValue({ status: "review_required" });
  mocks.sync.mockResolvedValue({ status: "review_required", drafts: [] });
});

describe("GET/POST /api/portal", () => {
  it("reads overview and tasks only with canonical context", async () => {
    const response = await GET(new Request("http://localhost/api/portal"));

    expect(response.status).toBe(200);
    expect(mocks.overview).toHaveBeenCalledWith(SALES);
    expect(mocks.tasks).toHaveBeenCalledWith(SALES);
  });

  it("routes connect as a review-required authenticated command", async () => {
    const response = await POST(postRequest({ action: "connect-outlook" }));

    expect(response.status).toBe(200);
    expect(mocks.connect).toHaveBeenCalledWith(SALES, {
      idempotencyKey: "portal-command-1",
    });
  });

  it("routes sync with exact account version and no caller scope", async () => {
    const response = await POST(
      postRequest({
        action: "sync-mail",
        expectedAccountUpdatedAt: "2026-07-24T00:00:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.sync).toHaveBeenCalledWith(SALES, {
      expectedAccountUpdatedAt: "2026-07-24T00:00:00.000Z",
      idempotencyKey: "portal-command-1",
    });
  });

  it("rejects missing key, caller scope, and legacy payload fields", async () => {
    const missingKey = await POST(
      postRequest({ action: "connect-outlook" }, ""),
    );
    const scope = await POST(
      postRequest({ action: "connect-outlook", projectId: "attacker-project" }),
    );
    const legacy = await POST(
      postRequest({ action: "sync-mail", projectSlug: "demo-project" }),
    );

    expect(missingKey.status).toBe(422);
    expect(scope.status).toBe(403);
    expect(legacy.status).toBe(403);
    expect(mocks.connect).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
