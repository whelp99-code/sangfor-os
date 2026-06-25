import { getDefaultPhase13Flow, getRoutingRules } from "./skill-catalog";
import {
  getLegacyPhase13SkillKeysFromEnv,
  resolvePhase13ExecutionProfile,
} from "./execution-profile";
import type { RecommendSkillsInput } from "./types";

export function recommendSkills(input: RecommendSkillsInput): string[] {
  const envKeys = getLegacyPhase13SkillKeysFromEnv();
  if (envKeys) {
    return envKeys;
  }

  const profile = resolvePhase13ExecutionProfile(input.executionProfile);
  if (profile.fixedSkillKeys && profile.fixedSkillKeys.length > 0) {
    return [...profile.fixedSkillKeys];
  }

  const phase = input.phase ?? 13;
  const summary = input.inputSummary.trim();
  const flow = getDefaultPhase13Flow();

  if (phase !== 13) {
    return flow;
  }

  const recommended = new Set<string>();

  for (const rule of getRoutingRules()) {
    const regex = new RegExp(rule.pattern, "i");
    if (regex.test(summary)) {
      for (const skillKey of rule.prependSkills) {
        recommended.add(skillKey);
      }
    }
  }

  for (const skillKey of flow) {
    recommended.add(skillKey);
  }

  if (input.module === "poc") {
    recommended.add("identify-assumptions-existing");
    recommended.add("brainstorm-experiments-existing");
  }

  if (input.module === "proposal") {
    recommended.add("create-prd");
  }

  return [...recommended];
}
