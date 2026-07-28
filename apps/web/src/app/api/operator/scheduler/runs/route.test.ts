import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  listScheduledJobs: vi.fn(async () => [{ jobKey: "daily-briefing", enabled: true }]),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
}));

describe("GET /api/operator/scheduler/runs", () => {
  it("returns list of scheduled job runs", async () => {
    const req = new NextRequest("http://localhost/api/operator/scheduler/runs");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.runs).toHaveLength(1);
  });
});
