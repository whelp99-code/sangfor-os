import { afterEach, describe, expect, it } from "vitest";

import {
  PHASE13_DEFAULT_SMOKE_SKILLS,
  getLegacyPhase13SkillKeysFromEnv,
  resolvePhase13ExecutionProfile,
  shouldUseLiveLlmForSkill,
} from "./execution-profile";

describe("execution-profile", () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it("returns smoke defaults", () => {
    const profile = resolvePhase13ExecutionProfile("smoke");
    expect(profile.name).toBe("smoke");
    expect(profile.fixedSkillKeys).toEqual([...PHASE13_DEFAULT_SMOKE_SKILLS]);
    expect(profile.maxCompletionTokensDefault).toBe(768);
  });

  it("accepts env overrides for token and concurrency", () => {
    process.env.OPENAI_MAX_COMPLETION_TOKENS = "900";
    process.env.PHASE13_SKILL_CONCURRENCY = "2";
    const profile = resolvePhase13ExecutionProfile("smoke");
    expect(profile.maxCompletionTokensDefault).toBe(900);
    expect(profile.skillConcurrency).toBe(2);
  });

  it("parses deprecated PHASE13_SKILL_KEYS", () => {
    process.env.PHASE13_SKILL_KEYS = "aios-impact-analysis, aios-work-breakdown";
    expect(getLegacyPhase13SkillKeysFromEnv()).toEqual([
      "aios-impact-analysis",
      "aios-work-breakdown",
    ]);
  });

  it("limits llm execution to aios skills by default", () => {
    const profile = resolvePhase13ExecutionProfile("full");
    expect(shouldUseLiveLlmForSkill("aios-impact-analysis", profile)).toBe(true);
    expect(shouldUseLiveLlmForSkill("create-prd", profile)).toBe(false);
  });
});
