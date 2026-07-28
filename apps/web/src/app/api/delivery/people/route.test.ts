import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/db", () => ({
  prisma: {
    userCompanyRole: {
      findMany: vi.fn(async () => [{ id: "m1", companyId: "c1", status: "active" }]),
    },
  },
}));

describe("GET /api/delivery/people", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns delivery roster for authenticated company", async () => {
    const req = new NextRequest("http://localhost/api/delivery/people");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(1);
  });
});
