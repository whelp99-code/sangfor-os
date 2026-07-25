import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  runRenewalProjectionBatch: vi.fn(async () => ({
    examinedCount: 1, createdCount: 1, alreadyPresentCount: 0, blockedCount: 0, failedCount: 0,
  })),
}));

describe("POST /api/operator/renewals/run", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs renewal projection batch and returns 200", async () => {
    const req = new NextRequest("http://localhost/api/operator/renewals/run", {
      method: "POST",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.examinedCount).toBe(1);
  });
});
