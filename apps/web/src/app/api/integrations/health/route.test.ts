import { describe, expect, it, beforeEach, vi } from "vitest";

const { mockProbeAll } = vi.hoisted(() => ({ mockProbeAll: vi.fn() }));
vi.mock("@sangfor/infra", () => ({ probeAllIntegrationTargets: mockProbeAll }));

import { GET } from "./route";

beforeEach(() => mockProbeAll.mockReset());

describe("GET /api/integrations/health", () => {
  it("returns overall ok (200) when all targets are healthy", async () => {
    mockProbeAll.mockResolvedValue([
      { id: "a", status: "healthy", upstream: "u", latencyMs: 5 },
      { id: "b", status: "healthy", upstream: "u", latencyMs: 7 },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.overall).toBe("ok");
    expect(body.summary).toMatchObject({ total: 2, healthy: 2, degraded: 0, unreachable: 0 });
    expect(body.targets).toHaveLength(2);
  });

  it("reports degraded when any target is unreachable or degraded", async () => {
    mockProbeAll.mockResolvedValue([
      { id: "a", status: "healthy", upstream: "u" },
      { id: "b", status: "unreachable", upstream: "u" },
      { id: "c", status: "degraded", upstream: "u" },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(body.overall).toBe("degraded");
    expect(body.summary).toMatchObject({ healthy: 1, degraded: 1, unreachable: 1 });
  });

  it("returns 500 with an error payload when probing fails", async () => {
    // A malformed result makes the handler throw inside its try/catch.
    mockProbeAll.mockResolvedValue(null);
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.overall).toBe("error");
    expect(typeof body.error).toBe("string");
    expect(body.targets).toEqual([]);
  });
});
