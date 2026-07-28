import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  getRoiDashboard: vi.fn(async () => ({ companyId: "c1", metrics: [] })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
}));

describe("GET /api/dashboard/roi", () => {
  it("returns ROI dashboard metrics", async () => {
    const req = new NextRequest("http://localhost/api/dashboard/roi");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.companyId).toBe("c1");
  });
});
