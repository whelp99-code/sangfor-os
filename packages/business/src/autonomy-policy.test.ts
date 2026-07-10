import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  resolveAutonomyMode,
  autonomyFromComputed,
  isAutopilotEnabled,
  __resetAutopilotEnabledCacheForTests,
  type AutonomyPolicyRow,
} from "./autonomy-policy";

function makePolicy(
  overrides: Partial<AutonomyPolicyRow> & { mode: string },
): AutonomyPolicyRow {
  return {
    minAutonomy: 0.9,
    minSamples: 10,
    requireColorGatePass: true,
    ...overrides,
  };
}

const baseInput = {
  domain: "mail",
  decisionType: "test",
  autonomy: { score: 0.95, samples: 20 },
  colorGatePass: true,
} as const;

describe("resolveAutonomyMode", () => {
  it("returns observe when no policy row exists (loadPolicy returns null)", async () => {
    const loadPolicy = async () => null;
    const result = await resolveAutonomyMode(baseInput, { loadPolicy });
    expect(result).toBe("observe");
  });

  it("kill-switch: AUTOPILOT_ENABLED=0 -> observe even with perfect auto policy", async () => {
    const loadPolicy = async () => makePolicy({ mode: "auto" });
    const result = await resolveAutonomyMode(baseInput, {
      loadPolicy,
      env: { AUTOPILOT_ENABLED: "0" },
    });
    expect(result).toBe("observe");
  });

  it("kill-switch: AUTOPILOT_ENABLED=false -> observe", async () => {
    const loadPolicy = async () => makePolicy({ mode: "auto" });
    const result = await resolveAutonomyMode(baseInput, {
      loadPolicy,
      env: { AUTOPILOT_ENABLED: "false" },
    });
    expect(result).toBe("observe");
  });

  it("insufficient samples: samples=9 below minSamples=10 -> suggest", async () => {
    const loadPolicy = async () =>
      makePolicy({ mode: "auto", minAutonomy: 0.9, minSamples: 10 });
    const result = await resolveAutonomyMode(
      { ...baseInput, autonomy: { score: 0.95, samples: 9 } },
      { loadPolicy },
    );
    expect(result).toBe("suggest");
  });

  it("boundary samples: samples=10 exactly meets minSamples=10 -> auto", async () => {
    const loadPolicy = async () =>
      makePolicy({ mode: "auto", minAutonomy: 0.9, minSamples: 10 });
    const result = await resolveAutonomyMode(
      { ...baseInput, autonomy: { score: 0.95, samples: 10 } },
      { loadPolicy },
    );
    expect(result).toBe("auto");
  });

  it("insufficient score: score=0.89 below minAutonomy=0.9 -> suggest", async () => {
    const loadPolicy = async () =>
      makePolicy({ mode: "auto", minAutonomy: 0.9, minSamples: 20 });
    const result = await resolveAutonomyMode(
      { ...baseInput, autonomy: { score: 0.89, samples: 20 } },
      { loadPolicy },
    );
    expect(result).toBe("suggest");
  });

  it("boundary score: score=0.9 exactly meets minAutonomy=0.9 -> auto", async () => {
    const loadPolicy = async () =>
      makePolicy({ mode: "auto", minAutonomy: 0.9, minSamples: 20 });
    const result = await resolveAutonomyMode(
      { ...baseInput, autonomy: { score: 0.9, samples: 20 } },
      { loadPolicy },
    );
    expect(result).toBe("auto");
  });

  it("color gate required and fails: colorGatePass=false -> suggest", async () => {
    const loadPolicy = async () =>
      makePolicy({ mode: "auto", requireColorGatePass: true });
    const result = await resolveAutonomyMode(
      { ...baseInput, colorGatePass: false },
      { loadPolicy },
    );
    expect(result).toBe("suggest");
  });

  it("color gate required and null: colorGatePass=null -> suggest", async () => {
    const loadPolicy = async () =>
      makePolicy({ mode: "auto", requireColorGatePass: true });
    const result = await resolveAutonomyMode(
      { ...baseInput, colorGatePass: null },
      { loadPolicy },
    );
    expect(result).toBe("suggest");
  });

  it("color gate not required and null: requireColorGatePass=false, colorGatePass=null -> auto", async () => {
    const loadPolicy = async () =>
      makePolicy({ mode: "auto", requireColorGatePass: false });
    const result = await resolveAutonomyMode(
      { ...baseInput, colorGatePass: null },
      { loadPolicy },
    );
    expect(result).toBe("auto");
  });

  it("all conditions met: auto mode with sufficient score/samples and color gate pass -> auto", async () => {
    const loadPolicy = async () =>
      makePolicy({
        mode: "auto",
        minAutonomy: 0.9,
        minSamples: 10,
        requireColorGatePass: true,
      });
    const result = await resolveAutonomyMode(
      {
        domain: "mail",
        decisionType: "test",
        autonomy: { score: 0.9, samples: 10 },
        colorGatePass: true,
      },
      { loadPolicy },
    );
    expect(result).toBe("auto");
  });

  it("input autonomy is null with policy mode auto -> suggest", async () => {
    const loadPolicy = async () => makePolicy({ mode: "auto" });
    const result = await resolveAutonomyMode(
      { ...baseInput, autonomy: null },
      { loadPolicy },
    );
    expect(result).toBe("suggest");
  });

  it("policy mode=suggest -> suggest regardless of autonomy", async () => {
    const loadPolicy = async () => makePolicy({ mode: "suggest" });
    const result = await resolveAutonomyMode(baseInput, { loadPolicy });
    expect(result).toBe("suggest");
  });

  it("policy mode is unknown -> observe (fail-safe)", async () => {
    const loadPolicy = async () => makePolicy({ mode: "bogus" });
    const result = await resolveAutonomyMode(baseInput, { loadPolicy });
    expect(result).toBe("observe");
  });

  it("policy mode=observe -> observe", async () => {
    const loadPolicy = async () => makePolicy({ mode: "observe" });
    const result = await resolveAutonomyMode(baseInput, { loadPolicy });
    expect(result).toBe("observe");
  });
});

describe("autonomyFromComputed", () => {
  it("returns null when pct is null (still learning)", () => {
    expect(autonomyFromComputed({ pct: null, sample: 3 })).toBeNull();
  });

  it("converts pct/100 to score 0..1", () => {
    expect(autonomyFromComputed({ pct: 85, sample: 12 })).toEqual({
      score: 0.85,
      samples: 12,
    });
  });

  it("handles 0% boundary", () => {
    expect(autonomyFromComputed({ pct: 0, sample: 5 })).toEqual({
      score: 0,
      samples: 5,
    });
  });

  it("handles 100% boundary", () => {
    expect(autonomyFromComputed({ pct: 100, sample: 1 })).toEqual({
      score: 1,
      samples: 1,
    });
  });
});

describe("resolveAutonomyMode with checkAutopilotEnabled dep (DB kill-switch opt-in)", () => {
  it("checkAutopilotEnabled resolves false -> observe even with a satisfied auto policy", async () => {
    const loadPolicy = async () => makePolicy({ mode: "auto" });
    const checkAutopilotEnabled = async () => false;
    const result = await resolveAutonomyMode(baseInput, { loadPolicy, checkAutopilotEnabled });
    expect(result).toBe("observe");
  });

  it("checkAutopilotEnabled resolves true -> falls through to normal policy evaluation", async () => {
    const loadPolicy = async () => makePolicy({ mode: "auto" });
    const checkAutopilotEnabled = async () => true;
    const result = await resolveAutonomyMode(baseInput, { loadPolicy, checkAutopilotEnabled });
    expect(result).toBe("auto");
  });

  it("env hard-off wins BEFORE checkAutopilotEnabled is even called", async () => {
    const loadPolicy = async () => makePolicy({ mode: "auto" });
    const checkAutopilotEnabled = vi.fn(async () => true);
    const result = await resolveAutonomyMode(baseInput, {
      loadPolicy,
      checkAutopilotEnabled,
      env: { AUTOPILOT_ENABLED: "0" },
    });
    expect(result).toBe("observe");
    expect(checkAutopilotEnabled).not.toHaveBeenCalled();
  });
});

describe("isAutopilotEnabled", () => {
  beforeEach(() => {
    __resetAutopilotEnabledCacheForTests();
  });

  it("env AUTOPILOT_ENABLED=0 -> false, DB reader never called (hard off)", async () => {
    const readConfigValue = vi.fn(async () => true);
    const result = await isAutopilotEnabled({
      env: { AUTOPILOT_ENABLED: "0" },
      readConfigValue,
    });
    expect(result).toBe(false);
    expect(readConfigValue).not.toHaveBeenCalled();
  });

  it("env AUTOPILOT_ENABLED=false -> false, DB reader never called (hard off)", async () => {
    const readConfigValue = vi.fn(async () => true);
    const result = await isAutopilotEnabled({
      env: { AUTOPILOT_ENABLED: "false" },
      readConfigValue,
    });
    expect(result).toBe(false);
    expect(readConfigValue).not.toHaveBeenCalled();
  });

  it("no env flag, DB has no stored value (null) -> defaults to enabled", async () => {
    const result = await isAutopilotEnabled({
      env: {},
      readConfigValue: async () => null,
    });
    expect(result).toBe(true);
  });

  it("no env flag, DB stores false -> disabled", async () => {
    const result = await isAutopilotEnabled({
      env: {},
      readConfigValue: async () => false,
    });
    expect(result).toBe(false);
  });

  it("no env flag, DB stores true -> enabled", async () => {
    const result = await isAutopilotEnabled({
      env: {},
      readConfigValue: async () => true,
    });
    expect(result).toBe(true);
  });

  it("DB read throws -> fails closed (false), does not propagate the error", async () => {
    const result = await isAutopilotEnabled({
      env: {},
      readConfigValue: async () => {
        throw new Error("connection refused");
      },
    });
    expect(result).toBe(false);
  });

  it("caches the DB result for ~30s: second call within TTL does not re-invoke the reader", async () => {
    const readConfigValue = vi.fn(async () => false);
    let clock = 1_000_000;
    const now = () => clock;

    const first = await isAutopilotEnabled({ env: {}, readConfigValue, now });
    expect(first).toBe(false);
    expect(readConfigValue).toHaveBeenCalledTimes(1);

    clock += 10_000; // +10s, still within the 30s TTL
    const second = await isAutopilotEnabled({ env: {}, readConfigValue, now });
    expect(second).toBe(false);
    expect(readConfigValue).toHaveBeenCalledTimes(1);
  });

  it("cache expires after ~30s: subsequent call re-invokes the reader", async () => {
    const readConfigValue = vi.fn(async () => false);
    let clock = 1_000_000;
    const now = () => clock;

    await isAutopilotEnabled({ env: {}, readConfigValue, now });
    expect(readConfigValue).toHaveBeenCalledTimes(1);

    clock += 30_001; // past the 30s TTL
    await isAutopilotEnabled({ env: {}, readConfigValue, now });
    expect(readConfigValue).toHaveBeenCalledTimes(2);
  });

  it("env hard-off always bypasses the cache, even right after a cached enabled result", async () => {
    const readConfigValue = vi.fn(async () => true);
    let clock = 1_000_000;
    const now = () => clock;

    const cached = await isAutopilotEnabled({ env: {}, readConfigValue, now });
    expect(cached).toBe(true);

    const hardOff = await isAutopilotEnabled({
      env: { AUTOPILOT_ENABLED: "0" },
      readConfigValue,
      now,
    });
    expect(hardOff).toBe(false);
  });
});
