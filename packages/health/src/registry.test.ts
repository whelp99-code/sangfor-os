/**
 * U006 — canonical health registry unit tests (no network).
 */
import { describe, expect, it, vi } from "vitest";
import { PORT_REGISTRY, getUrl } from "@sangfor/config";
import {
  FAKE_HEALTH_DOMAIN_PATTERN,
  HEALTH_REGISTRY,
  getHealthRegistryEntry,
  listHealthRegistryEntries,
  probeCanonicalHealth,
  redactHealthText,
  redactHealthUrl,
} from "./registry.js";

function mockResponse(
  body: string,
  init: { ok: boolean; status: number },
): Response {
  return {
    ok: init.ok,
    status: init.status,
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("HEALTH_REGISTRY shape", () => {
  it("covers the four real infra integration targets", () => {
    const ids = listHealthRegistryEntries().map((e) => e.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "whelp99-code-sangfor-engineer-mcp",
        "sangfor-mcp-workflow",
        "sangfor-engineer-operator-console",
        "sangfor-mock-console",
      ]),
    );
    expect(ids).toHaveLength(4);
  });

  it("entries carry required fields including redaction-safe remediation", () => {
    for (const entry of HEALTH_REGISTRY) {
      expect(entry.id).toBeTruthy();
      expect(entry.ownerWorkspace).toBeTruthy();
      expect(entry.envSource).toBeTruthy();
      expect(["critical", "optional"]).toContain(entry.criticality);
      expect(typeof entry.enabledPredicate).toBe("function");
      expect(entry.timeoutMs).toBeGreaterThan(0);
      expect(entry.remediation.length).toBeGreaterThan(10);
      expect(entry.remediation).not.toMatch(/password|secret=|api[_-]?key=/i);
    }
  });

  it("target default ports match U003 PORT_REGISTRY", () => {
    expect(PORT_REGISTRY.WHELP99_MCP_BRIDGE).toBe(3600);
    expect(PORT_REGISTRY.SANGFOR_MCP).toBe(3500);
    expect(PORT_REGISTRY.WHELP99_OPERATOR_CONSOLE).toBe(3502);
    expect(PORT_REGISTRY.SANGFOR_MOCK_CONSOLE).toBe(3400);
    expect(getUrl("WHELP99_MCP_BRIDGE", "/health")).toContain(":3600");
  });
});

describe("probeCanonicalHealth", () => {
  it("marks optional disabled targets as disabled and does not count them healthy", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockResponse("ok", { ok: true, status: 200 }));

    const report = await probeCanonicalHealth({
      env: {
        HEALTH_MOCK_CONSOLE_ENABLED: "0",
        HEALTH_OPERATOR_CONSOLE_ENABLED: "0",
        SANGFOR_PROCESS_PROFILE: "local",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => Date.parse("2026-01-01T00:00:00.000Z"),
    });

    const disabled = report.services.filter((s) => s.status === "disabled");
    expect(disabled.length).toBeGreaterThanOrEqual(1);
    expect(report.summary.disabled).toBe(disabled.length);
    // healthy count excludes disabled
    expect(report.summary.ok + report.summary.degraded + report.summary.error).toBe(
      report.summary.total - report.summary.disabled,
    );
    expect(report.summary.ok).not.toBe(report.summary.total);
    // fetch not called for disabled entries
    expect(fetchImpl.mock.calls.length).toBe(
      report.summary.total - report.summary.disabled,
    );
  });

  it("returns 503 when an enabled critical probe times out / errors", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (url: string) => {
      if (String(url).includes("3500") || String(url).includes("system/health")) {
        throw new Error("AbortError");
      }
      return mockResponse("ok", { ok: true, status: 200 });
    });

    const report = await probeCanonicalHealth({
      env: {
        HEALTH_MOCK_CONSOLE_ENABLED: "0",
        HEALTH_OPERATOR_CONSOLE_ENABLED: "0",
        SANGFOR_PROCESS_PROFILE: "local",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      timeoutMs: 50,
    });

    expect(report.httpStatus).toBe(503);
    expect(report.overall).toMatch(/degraded|error/);
    const workflow = report.services.find((s) => s.id === "sangfor-mcp-workflow");
    expect(workflow?.status).toMatch(/error|degraded/);
  });

  it("returns 200 when all enabled critical targets are healthy", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockResponse('{"status":"ok"}', { ok: true, status: 200 }));

    const report = await probeCanonicalHealth({
      env: {
        HEALTH_MOCK_CONSOLE_ENABLED: "0",
        HEALTH_OPERATOR_CONSOLE_ENABLED: "0",
        SANGFOR_PROCESS_PROFILE: "test",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(report.httpStatus).toBe(200);
    expect(report.overall).toBe("ok");
    expect(report.summary.error).toBe(0);
    expect(report.summary.degraded).toBe(0);
  });

  it("never puts secret sentinel strings into the report body", async () => {
    const secret = "super-secret-sentinel-u006-xyz";
    const fetchImpl = vi.fn().mockResolvedValue(
      mockResponse(`leaked ${secret}`, { ok: true, status: 200 }),
    );

    const report = await probeCanonicalHealth({
      env: {
        SANGFOR_API_KEY: secret,
        HEALTH_MOCK_CONSOLE_ENABLED: "0",
        HEALTH_OPERATOR_CONSOLE_ENABLED: "0",
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(secret);
    expect(serialized).toMatch(/\[REDACTED\]|ok|healthy/i);
  });

  it("does not use hard-coded fake sangfor.internal hosts", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockResponse("ok", { ok: true, status: 200 }));
    const report = await probeCanonicalHealth({
      env: { HEALTH_MOCK_CONSOLE_ENABLED: "0", HEALTH_OPERATOR_CONSOLE_ENABLED: "0" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(FAKE_HEALTH_DOMAIN_PATTERN);
    for (const s of report.services) {
      if (s.status !== "disabled") {
        expect(s.url).toMatch(/^https?:\/\/(localhost|127\.0\.0\.1)/);
      }
    }
  });

  it("never hits the network when fetchImpl is injected", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockResponse("ok", { ok: true, status: 200 }));
    await probeCanonicalHealth({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      env: { HEALTH_OPERATOR_CONSOLE_ENABLED: "0", HEALTH_MOCK_CONSOLE_ENABLED: "0" },
    });
    expect(fetchImpl).toHaveBeenCalled();
    // All calls are to our mock — no real network
    for (const call of fetchImpl.mock.calls) {
      expect(typeof call[0]).toBe("string");
    }
  });
});

describe("redaction helpers", () => {
  it("strips userinfo and secret query params from URLs", () => {
    const redacted = redactHealthUrl(
      "http://user:pass@localhost:3600/health?api_key=abc&ok=1",
    );
    expect(redacted).not.toContain("user");
    expect(redacted).not.toContain("pass");
    expect(redacted).not.toContain("abc");
    expect(redacted).toContain("ok=1");
  });

  it("redacts env secrets from free text", () => {
    expect(
      redactHealthText("token=sekrit123", { SANGFOR_API_KEY: "sekrit123" }),
    ).toContain("[REDACTED]");
  });
});

describe("getHealthRegistryEntry", () => {
  it("returns undefined for unknown ids", () => {
    expect(getHealthRegistryEntry("nope")).toBeUndefined();
  });
});
