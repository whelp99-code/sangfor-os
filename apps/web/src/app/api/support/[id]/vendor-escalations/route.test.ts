import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/db", () => ({
  prisma: {
    vendorEscalation: {
      create: vi.fn(async () => ({ id: "ve1", status: "draft" })),
    },
  },
}));

describe("POST /api/support/[id]/vendor-escalations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates vendor escalation for case", async () => {
    const req = new NextRequest("http://localhost/api/support/sc1/vendor-escalations", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create",
        ownerAssignmentId: "ucr1",
        reason: "Hardware Defect",
      }),
    });

    const res = await POST(req, { params: Promise.resolve({ id: "sc1" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.id).toBe("ve1");
  });
});
