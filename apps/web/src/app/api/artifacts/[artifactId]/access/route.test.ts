import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST, GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  createArtifactAccessEvent: vi.fn(async () => ({ id: "ev1" })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1", businessRole: "account_executive", permissions: [], product: "portal" })),
  ArtifactAccessError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

vi.mock("@sangfor/db", () => ({
  prisma: {
    $transaction: vi.fn(async (cb: any) => cb({
      artifactAccessEvent: { create: vi.fn(async () => ({ id: "ev1" })) },
    })),
  },
  appendAuditEvent: vi.fn(async () => ({ id: "audit1" })),
}));

describe("POST /api/artifacts/[artifactId]/access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 with watermark for view action", async () => {
    const req = new NextRequest("http://localhost/api/artifacts/art1/access", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "view", artifactVersionId: "av1" }),
    });
    const res = await POST(req, { params: Promise.resolve({ artifactId: "art1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.policyResult).toBe("allowed");
    expect(json.watermark).toBeDefined();
  });

  it("returns 405 for GET", async () => {
    const res = await GET();
    expect(res.status).toBe(405);
  });
});
