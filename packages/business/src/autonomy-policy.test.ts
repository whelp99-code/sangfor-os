import { describe, expect, it } from "vitest";

import {
  resolveAutonomyMode,
  autonomyFromComputed,
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
