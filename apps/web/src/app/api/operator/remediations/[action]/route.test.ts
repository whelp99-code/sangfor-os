import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ reprobeTarget: vi.fn() }));

vi.mock("@/lib/auth/persisted-session", () => ({
  evaluatePersistedSessionFromRequest: vi.fn(async () => ({
    ok: true, userId: "u1", tenantId: "t1", companyId: "c1", projectId: "p1",
  })),
}));

vi.mock("@sangfor/business", () => ({
  reprobeTarget: mocks.reprobeTarget,
  acknowledgeObservation: vi.fn(async () => ({ targetId: "postgres-primary", observationId: "obs1" })),
  resolveCrmAuthContext: vi.fn(async (x: any) => ({ ...x, sessionId: "s1" })),
  IntegrationObservabilityError: class extends Error {
    code: string; httpStatus: number;
    constructor(code: string, message: string, s = 400) { super(message); this.code = code; this.httpStatus = s; }
  },
}));

describe("POST /api/operator/remediations/[action]", () => {
  beforeEach(() => {
    mocks.reprobeTarget.mockResolvedValue({ targetId: "postgres-primary", state: "healthy", latencyMs: 5 });
  });

  it("executes reprobe-target action", async () => {
    const req = new NextRequest("http://localhost/api/operator/remediations/reprobe-target", {
      method: "POST",
      headers: { "Idempotency-Key": "k1".repeat(8), "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: "postgres-primary" }),
    });
    const res = await POST(req, { params: Promise.resolve({ action: "reprobe-target" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.state).toBe("healthy");
  });

  it("returns unavailable when no probe evidence adapter exists", async () => {
    mocks.reprobeTarget.mockResolvedValue({ targetId: "redis-cache", state: "unknown", latencyMs: null });
    const req = new NextRequest("http://localhost/api/operator/remediations/reprobe-target", {
      method: "POST",
      headers: { "Idempotency-Key": "k2".repeat(8), "Content-Type": "application/json" },
      body: JSON.stringify({ targetId: "redis-cache" }),
    });
    const res = await POST(req, { params: Promise.resolve({ action: "reprobe-target" }) });
    expect(res.status).toBe(503);
  });
});
