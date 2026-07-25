import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  consumeDataExport: vi.fn(async () => ({ exportId: "exp1", status: "consumed", artifactVersionId: "av1" })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1", businessRole: "account_executive", permissions: [], product: "portal" })),
  ArtifactAccessError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

describe("GET /api/exports/[exportId]", () => {
  it("consumes export with valid capability header", async () => {
    const req = new NextRequest("http://localhost/api/exports/exp1", {
      method: "GET",
      headers: { "Authorization": `Capability exp1.${"a".repeat(43)}` },
    });
    const res = await GET(req, { params: Promise.resolve({ exportId: "exp1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("consumed");
  });

  it("returns 401 without capability header", async () => {
    const req = new NextRequest("http://localhost/api/exports/exp1", { method: "GET" });
    const res = await GET(req, { params: Promise.resolve({ exportId: "exp1" }) });
    expect(res.status).toBe(401);
  });
});
