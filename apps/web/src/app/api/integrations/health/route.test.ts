import { describe, expect, it, beforeEach, vi } from "vitest";

const { mockProbeCanonical, mockRecordAndDetect, mockNotifyTransitions } = vi.hoisted(() => ({
  mockProbeCanonical: vi.fn(),
  mockRecordAndDetect: vi.fn(),
  mockNotifyTransitions: vi.fn(),
}));
vi.mock("@sangfor/health", () => ({ probeCanonicalHealth: mockProbeCanonical }));
vi.mock("@/lib/health/history-store", () => ({
  healthHistory: { recordAndDetect: mockRecordAndDetect },
}));
vi.mock("@/lib/health/alerts", () => ({ notifyTransitions: mockNotifyTransitions }));

import { GET } from "./route";

beforeEach(() => {
  mockProbeCanonical.mockReset();
  mockRecordAndDetect.mockReset();
  mockRecordAndDetect.mockReturnValue([]);
  mockNotifyTransitions.mockReset();
});

describe("GET /api/integrations/health", () => {
  it("is a U006 canonical-health consumer rather than a second infra registry", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(new URL("./route.ts", import.meta.url), "utf8"),
    );
    expect(source).toContain('from "@sangfor/health"');
    expect(source).not.toContain("probeAllIntegrationTargets");
  });

  it("serializes the canonical report and only exposes legacy targets as a presentation adapter", async () => {
    mockProbeCanonical.mockResolvedValue({
      httpStatus: 200,
      overall: "ok",
      summary: { total: 2, ok: 1, degraded: 0, error: 0, disabled: 1, timestamp: "2026-01-01T00:00:00.000Z" },
      services: [
        { id: "whelp99-code-sangfor-engineer-mcp", name: "bridge", url: "http://localhost:3600/health", status: "ok", criticality: "critical", ownerWorkspace: "services/sangfor-engineer-mcp", remediation: "check bridge", latencyMs: 5 },
        { id: "sangfor-mock-console", name: "mock", url: "http://localhost:3400", status: "disabled", criticality: "optional", ownerWorkspace: "services/sangfor-engineer-mcp", remediation: "disabled" },
      ],
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.overall).toBe("ok");
    expect(body.services[0]).toMatchObject({ id: "whelp99-code-sangfor-engineer-mcp", status: "ok" });
    expect(body.targets).toEqual([
      expect.objectContaining({ id: "whelp99-code-sangfor-engineer-mcp", status: "healthy" }),
      expect.objectContaining({ id: "sangfor-mock-console", status: "disabled" }),
    ]);
    expect(body.summary).toMatchObject({ total: 2, healthy: 1, degraded: 0, unreachable: 0, unknown: 0, disabled: 1 });
    expect(body.targets).toHaveLength(2);
    expect(mockRecordAndDetect).toHaveBeenCalledWith([
      { id: "whelp99-code-sangfor-engineer-mcp", status: "healthy", latencyMs: 5 },
      { id: "sangfor-mock-console", status: "disabled", latencyMs: undefined },
    ]);
  });

  it("never renders canonical unknown or unreachable services as healthy or zero", async () => {
    mockProbeCanonical.mockResolvedValue({
      httpStatus: 503,
      overall: "error",
      summary: { total: 2, ok: 0, degraded: 0, error: 1, disabled: 0, timestamp: "2026-01-01T00:00:00.000Z" },
      services: [
        { id: "sangfor-mcp-workflow", name: "workflow", url: "http://localhost:3500", status: "error", criticality: "critical", ownerWorkspace: "services/sangfor-mcp-workflow", remediation: "restart" },
        { id: "sangfor-engineer-operator-console", name: "operator", url: "http://localhost:3502", status: "unknown", criticality: "optional", ownerWorkspace: "services/sangfor-mcp-workflow", remediation: "inspect" },
      ],
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.overall).toBe("error");
    expect(body.summary).toMatchObject({ healthy: 0, unreachable: 1, unknown: 1 });
    expect(body.targets).toEqual([
      expect.objectContaining({ id: "sangfor-mcp-workflow", status: "unreachable" }),
      expect.objectContaining({ id: "sangfor-engineer-operator-console", status: "unknown" }),
    ]);
  });

  it("returns an honest degraded response if the canonical probe itself fails", async () => {
    mockProbeCanonical.mockRejectedValue(new Error("probe failure"));
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.overall).toBe("error");
    expect(typeof body.error).toBe("string");
    expect(body.targets).toEqual([]);
    expect(body.summary).toMatchObject({ healthy: 0, unknown: 1 });
  });
});
