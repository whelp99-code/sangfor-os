import { beforeEach, describe, expect, it, vi } from "vitest";

import { probeCanonicalHealth, resetHealthTransitions } from "./registry";

const ENV = {
  HEALTH_MOCK_CONSOLE_ENABLED: "0",
  HEALTH_OPERATOR_CONSOLE_ENABLED: "0",
  SANGFOR_PROCESS_PROFILE: "local",
} as const;

function okResponse() {
  return {
    ok: true,
    status: 200,
    text: async () => "ok",
  } as unknown as Response;
}

/** Fails every probe so each enabled target transitions to unreachable. */
const failingFetch = () => vi.fn(async () => {
  throw new Error("ECONNREFUSED");
}) as unknown as typeof fetch;

const healthyFetch = () => vi.fn(async () => okResponse()) as unknown as typeof fetch;

describe("probeCanonicalHealth transition tracking", () => {
  beforeEach(() => resetHealthTransitions());

  it("counts consecutive failures per target across probes", async () => {
    const first = await probeCanonicalHealth({ env: ENV, fetchImpl: failingFetch(), timeoutMs: 20 });
    const firstFailing = first.services.find((s) => s.status === "error" || s.status === "degraded");
    expect(firstFailing?.consecutiveFailures).toBe(1);

    const second = await probeCanonicalHealth({ env: ENV, fetchImpl: failingFetch(), timeoutMs: 20 });
    const secondFailing = second.services.find((s) => s.id === firstFailing?.id);
    expect(secondFailing?.consecutiveFailures).toBe(2);
    expect(secondFailing?.recoveredAt).toBeUndefined();
  });

  it("records a verified recovery when a failed target probes healthy again", async () => {
    await probeCanonicalHealth({ env: ENV, fetchImpl: failingFetch(), timeoutMs: 20 });

    const recovered = await probeCanonicalHealth({
      env: ENV,
      fetchImpl: healthyFetch(),
      now: () => Date.parse("2026-01-02T03:04:05.000Z"),
    });

    const healthy = recovered.services.find((s) => s.status === "ok");
    expect(healthy?.consecutiveFailures).toBe(0);
    expect(healthy?.recoveredAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("keeps a target that never failed free of a recovery marker", async () => {
    const report = await probeCanonicalHealth({
      env: ENV,
      fetchImpl: healthyFetch(),
      now: () => Date.parse("2026-01-02T03:04:05.000Z"),
    });

    const healthy = report.services.find((s) => s.status === "ok");
    expect(healthy?.consecutiveFailures).toBe(0);
    expect(healthy?.recoveredAt).toBeUndefined();
  });
});
