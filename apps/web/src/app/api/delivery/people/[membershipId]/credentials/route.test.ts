import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET, POST, PATCH } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/db", () => ({
  prisma: {
    engineerCertification: {
      findMany: vi.fn(async () => []),
      create: vi.fn(async () => ({ id: "c1", status: "pending", revision: 0 })),
      update: vi.fn(async () => ({ id: "c1", status: "revoked" })),
    },
    engineerSkill: {
      findMany: vi.fn(async () => []),
    },
  },
}));

describe("Credentials Route Tests", () => {
  beforeEach(() => vi.clearAllMocks());

  it("gets credentials for membership", async () => {
    const req = new NextRequest("http://localhost/api/delivery/people/m1/credentials");
    const res = await GET(req, { params: Promise.resolve({ membershipId: "m1" }) });
    expect(res.status).toBe(200);
  });

  it("registers certification via POST", async () => {
    const req = new NextRequest("http://localhost/api/delivery/people/m1/credentials", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register_certification", definitionId: "def1" }),
    });

    const res = await POST(req, { params: Promise.resolve({ membershipId: "m1" }) });
    expect(res.status).toBe(201);
  });

  it("revokes certification via PATCH", async () => {
    const req = new NextRequest("http://localhost/api/delivery/people/m1/credentials", {
      method: "PATCH",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "revoke_certification", certificationId: "c1", reason: "Expired" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ membershipId: "m1" }) });
    expect(res.status).toBe(200);
  });
});
