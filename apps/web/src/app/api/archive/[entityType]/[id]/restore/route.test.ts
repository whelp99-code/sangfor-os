import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  restoreArchivedEntity: vi.fn(async () => ({ restored: true, id: "c1", entityType: "customer", restoreStatus: "active" })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
  ArchiveError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

describe("POST /api/archive/[entityType]/[id]/restore", () => {
  it("restores archived entity", async () => {
    const req = new NextRequest("http://localhost/api/archive/customer/c1/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: "2026-07-25T00:00:00.000Z", restoreStatus: "active" }),
    });
    const res = await POST(req, { params: Promise.resolve({ entityType: "customer", id: "c1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.restored).toBe(true);
  });
});
