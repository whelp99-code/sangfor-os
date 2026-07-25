import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  listArchivedEntities: vi.fn(async () => ({ nodes: [], totalCount: 0, truncated: false })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
  ArchiveError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

describe("GET /api/archive", () => {
  it("returns list of archived entities", async () => {
    const req = new NextRequest("http://localhost/api/archive");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.nodes).toEqual([]);
    expect(json.truncated).toBe(false);
  });
});
