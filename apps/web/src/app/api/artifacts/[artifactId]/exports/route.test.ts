import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  issueDataExport: vi.fn(async () => ({ exportId: "exp1", capabilityId: "cap1", status: "issued", expiresAt: new Date(), capability: "exp1.aaa" })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1", businessRole: "account_executive", permissions: [], product: "portal" })),
  ArtifactAccessError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

describe("POST /api/artifacts/[artifactId]/exports", () => {
  it("issues export and returns 201 with capability", async () => {
    const req = new NextRequest("http://localhost/api/artifacts/art1/exports", {
      method: "POST",
      headers: { "Idempotency-Key": "k1", "Content-Type": "application/json" },
      body: JSON.stringify({ artifactVersionId: "av1", approvalId: "apr1", purpose: "legal review", format: "json" }),
    });
    const res = await POST(req, { params: Promise.resolve({ artifactId: "art1" }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.exportId).toBe("exp1");
    expect(json.capability).toBeDefined();
  });
});
