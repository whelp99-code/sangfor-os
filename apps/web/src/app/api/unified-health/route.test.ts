/**
 * U006 — unified-health must be registry-driven (no hard-coded fake domains).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetEmbedderHealth, mockProbeAll } = vi.hoisted(() => ({
  mockGetEmbedderHealth: vi.fn(),
  mockProbeAll: vi.fn(),
}));

vi.mock("@sangfor/health", () => ({
  probeCanonicalHealth: mockProbeAll,
  FAKE_HEALTH_DOMAIN_PATTERN: /\.sangfor\.internal\b/i,
}));
vi.mock("@sangfor/business", () => ({
  getEmbedderHealth: mockGetEmbedderHealth,
}));

import { GET } from "./route";

const routeSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8",
);

beforeEach(() => {
  mockGetEmbedderHealth.mockReset();
  mockGetEmbedderHealth.mockReturnValue({
    consecutiveFailures: 2,
    lastFailureReason: "network_error",
    lastFailureAt: "2026-01-01T00:00:00.000Z",
  });
  mockProbeAll.mockReset();
});

describe("GET /api/unified-health (U006)", () => {
  it("does not hard-code fake sangfor.internal domains or static green SERVICES", () => {
    expect(routeSource).not.toMatch(/\.sangfor\.internal\b/i);
    expect(routeSource).not.toMatch(/const\s+SERVICES\s*=\s*\[/);
    expect(routeSource).toMatch(/@sangfor\/health|probeCanonicalHealth/);
  });

  it("returns 200 when all enabled critical targets are healthy", async () => {
    mockProbeAll.mockResolvedValue({
      httpStatus: 200,
      overall: "ok",
      summary: {
        total: 3,
        ok: 3,
        degraded: 0,
        error: 0,
        disabled: 0,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      services: [
        {
          id: "whelp99-code-sangfor-engineer-mcp",
          name: "Engineer MCP bridge",
          url: "http://localhost:3600/health",
          status: "ok",
          criticality: "critical",
          consecutiveFailures: 0,
          recoveredAt: "2026-01-01T00:00:00.000Z",
          latencyMs: 5,
          ownerWorkspace: "services/sangfor-engineer-mcp",
          remediation: "Check bridge process on WHELP99_MCP_BRIDGE port",
        },
      ],
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.overall).toBe("ok");
    expect(body.services[0]).toMatchObject({
      consecutiveFailures: 0,
      recoveredAt: "2026-01-01T00:00:00.000Z",
    });
    expect(body.embedder).toEqual({
      consecutiveFailures: 2,
      lastFailureReason: "network_error",
      lastFailureAt: "2026-01-01T00:00:00.000Z",
    });
    expect(JSON.stringify(body)).not.toMatch(/\.sangfor\.internal\b/i);
    expect(mockProbeAll).toHaveBeenCalled();
  });

  it("returns 503 when an enabled critical target is unavailable", async () => {
    mockProbeAll.mockResolvedValue({
      httpStatus: 503,
      overall: "degraded",
      summary: {
        total: 2,
        ok: 1,
        degraded: 0,
        error: 1,
        disabled: 0,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      services: [
        {
          id: "sangfor-mcp-workflow",
          name: "Workflow MCP",
          url: "http://localhost:3500/api/system/health",
          status: "error",
          criticality: "critical",
          latencyMs: 3000,
          ownerWorkspace: "services/sangfor-mcp-workflow",
          remediation: "Restart workflow service; confirm SANGFOR_MCP port",
        },
      ],
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.overall).toMatch(/degraded|error/);
  });

  it("reports optional disabled services without counting them healthy", async () => {
    mockProbeAll.mockResolvedValue({
      httpStatus: 200,
      overall: "ok",
      summary: {
        total: 2,
        ok: 1,
        degraded: 0,
        error: 0,
        disabled: 1,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      services: [
        {
          id: "crit",
          status: "ok",
          criticality: "critical",
          url: "http://localhost:3600/health",
        },
        {
          id: "sangfor-mock-console",
          status: "disabled",
          criticality: "optional",
          url: "http://localhost:3400/",
        },
      ],
      timestamp: "2026-01-01T00:00:00.000Z",
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.summary.disabled).toBe(1);
    expect(body.summary.ok).toBe(1);
    const disabled = body.services.find(
      (s: { status: string }) => s.status === "disabled",
    );
    expect(disabled).toBeTruthy();
    expect(body.summary.ok).not.toBe(body.summary.total);
  });

  it("never echoes secret sentinel strings in the response body", async () => {
    const secret = "super-secret-sentinel-u006-xyz";
    mockProbeAll.mockResolvedValue({
      httpStatus: 200,
      overall: "ok",
      summary: {
        total: 1,
        ok: 1,
        degraded: 0,
        error: 0,
        disabled: 0,
        timestamp: "2026-01-01T00:00:00.000Z",
      },
      services: [
        {
          id: "a",
          status: "ok",
          criticality: "critical",
          url: "http://localhost:3600/health",
          remediation: "safe remediation text",
        },
      ],
      timestamp: "2026-01-01T00:00:00.000Z",
      // route must not forward raw secrets even if a buggy probe did
      _leaked: secret,
    });

    const res = await GET();
    const text = await res.text();
    expect(text).not.toContain(secret);
  });
});
