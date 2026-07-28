import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertApiAccess: vi.fn(() => null),
  evaluateSession: vi.fn(),
  resolveContext: vi.fn(),
  syncCalendarMeetings: vi.fn(),
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
}));
vi.mock("@/lib/outlook", () => ({
  syncCalendarMeetings: mocks.syncCalendarMeetings,
}));

import { POST } from "./route";

const SALES: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["opportunity.read", "opportunity.write"],
  product: "portal",
};

function request(body: unknown, key = "calendar-sync-1") {
  const headers = new Headers({ "content-type": "application/json" });
  if (key) headers.set("idempotency-key", key);
  return new Request("http://localhost/api/mail/calendar-sync", {
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
  mocks.syncCalendarMeetings.mockResolvedValue({
    fetched: 2,
    matched: 1,
    created: 1,
  });
});

describe("POST /api/mail/calendar-sync", () => {
  it("derives context once and sends only the bounded calendar command", async () => {
    const response = await POST(
      request({
        opportunityId: "opportunity-1",
        daysBack: 30,
        daysAhead: 7,
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.syncCalendarMeetings).toHaveBeenCalledWith(SALES, {
      opportunityId: "opportunity-1",
      daysBack: 30,
      daysAhead: 7,
      idempotencyKey: "calendar-sync-1",
    });
  });

  it("rejects caller-selected scope, unknown fields, and a missing key", async () => {
    const scope = await POST(
      request({ daysBack: 30, projectSlug: "attacker-project" }),
    );
    const unknown = await POST(request({ daysBack: 30, force: true }));
    const missingKey = await POST(request({ daysBack: 30 }, ""));

    expect(scope.status).toBe(403);
    expect(unknown.status).toBe(422);
    expect(missingKey.status).toBe(422);
    expect(mocks.syncCalendarMeetings).not.toHaveBeenCalled();
  });
});
