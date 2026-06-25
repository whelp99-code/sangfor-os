import type { SkillCatalogEntry } from "./types";

export type Phase13ExecutionProfile = "full" | "smoke" | "minimal";
export type LlmSkillFilter = "all" | "aios-prefix" | "none";

export type Phase13ExecutionProfileConfig = {
  name: Phase13ExecutionProfile;
  fixedSkillKeys?: string[];
  maxCompletionTokensDefault: number;
  skillDocMaxChars: number;
  llmSkillFilter: LlmSkillFilter;
  skillConcurrency: number;
};

export const PHASE13_DEFAULT_SMOKE_SKILLS = [
  "aios-impact-analysis",
  "aios-work-breakdown",
  "aios-agent-assignment",
] as const;

const DEFAULT_CONFIG: Record<Phase13ExecutionProfile, Phase13ExecutionProfileConfig> = {
  full: {
    name: "full",
    maxCompletionTokensDefault: 2048,
    skillDocMaxChars: 2000,
    llmSkillFilter: "aios-prefix",
    skillConcurrency: 3,
  },
  smoke: {
    name: "smoke",
    fixedSkillKeys: [...PHASE13_DEFAULT_SMOKE_SKILLS],
    maxCompletionTokensDefault: 768,
    skillDocMaxChars: 1200,
    llmSkillFilter: "aios-prefix",
    skillConcurrency: 3,
  },
  minimal: {
    name: "minimal",
    fixedSkillKeys: ["aios-work-breakdown"],
    maxCompletionTokensDefault: 1024,
    skillDocMaxChars: 1200,
    llmSkillFilter: "aios-prefix",
    skillConcurrency: 1,
  },
};

let warnedLegacySkillOverride = false;

export function getLegacyPhase13SkillKeysFromEnv(): string[] | null {
  const raw = process.env.PHASE13_SKILL_KEYS?.trim();
  if (!raw) return null;
  const keys = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (keys.length === 0) return null;

  if (!warnedLegacySkillOverride) {
    warnedLegacySkillOverride = true;
    console.warn(
      "PHASE13_SKILL_KEYS is deprecated. Use executionProfile='smoke' instead.",
    );
  }
  return keys;
}

function resolveFromEnv(base: Phase13ExecutionProfileConfig): Phase13ExecutionProfileConfig {
  const envMax = Number.parseInt(
    process.env.OPENAI_MAX_COMPLETION_TOKENS?.trim() ?? "",
    10,
  );
  const envDoc = Number.parseInt(
    process.env.PHASE13_SKILL_DOC_MAX_CHARS?.trim() ?? "",
    10,
  );
  const envConcurrency = Number.parseInt(
    process.env.PHASE13_SKILL_CONCURRENCY?.trim() ?? "",
    10,
  );

  return {
    ...base,
    maxCompletionTokensDefault:
      Number.isFinite(envMax) && envMax > 0 ? envMax : base.maxCompletionTokensDefault,
    skillDocMaxChars:
      Number.isFinite(envDoc) && envDoc > 0 ? envDoc : base.skillDocMaxChars,
    skillConcurrency:
      Number.isFinite(envConcurrency) && envConcurrency > 0
        ? envConcurrency
        : base.skillConcurrency,
  };
}

export function resolvePhase13ExecutionProfile(
  requested?: Phase13ExecutionProfile,
): Phase13ExecutionProfileConfig {
  const profile = requested ?? "full";
  return resolveFromEnv(DEFAULT_CONFIG[profile]);
}

export function shouldUseLiveLlmForSkill(
  skillKey: string,
  profile: { llmSkillFilter: LlmSkillFilter },
): boolean {
  if (process.env.PHASE13_LLM_ALL === "1") return true;
  if (profile.llmSkillFilter === "none") return false;
  if (profile.llmSkillFilter === "all") return true;
  return skillKey.startsWith("aios-");
}

export function skillFolderNameFromCatalog(entry: SkillCatalogEntry): string {
  if (entry.plugin === "aios" && entry.skillKey.startsWith("aios-")) {
    return entry.skillKey.slice("aios-".length);
  }
  return entry.skillKey;
}
