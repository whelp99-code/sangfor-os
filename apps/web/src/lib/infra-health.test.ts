import { describe, expect, it } from "vitest";

import { checkInfraHealth, isInfraHealthy } from "./infra-health";

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("checkInfraHealth integration", () => {
  it("connects to postgres and redis when services are up", async () => {
    const result = await checkInfraHealth(process.env);
    expect(isInfraHealthy(result)).toBe(true);
    expect(result.postgres.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.redis.latencyMs).toBeGreaterThanOrEqual(0);
  }, 15_000);
});

describe("isInfraHealthy", () => {
  it("returns false when any dependency fails", () => {
    expect(
      isInfraHealthy({
        postgres: { ok: false, error: "down" },
        redis: { ok: true, latencyMs: 1 },
      }),
    ).toBe(false);
  });
});
