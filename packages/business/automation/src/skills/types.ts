export type SkillSource = "pm" | "custom";
export type SkillStatus = "enabled" | "deferred" | "custom";
export type AgentType = "cursor" | "codex" | "human";
export type ExecutionMode = "template" | "llm";

export type SkillCatalogEntry = {
  skillKey: string;
  source: SkillSource;
  plugin?: string;
  phases: number[];
  status: SkillStatus;
  usage?: string;
  agentUsage: AgentType[];
};

export type SkillCatalogFile = {
  version: number;
  pinnedSha: string;
  skills: SkillCatalogEntry[];
  defaultPhase13Flow: string[];
  routingRules: Array<{
    pattern: string;
    prependSkills: string[];
  }>;
};

export type RecommendSkillsInput = {
  inputSummary: string;
  module?: string;
  phase?: number;
  executionProfile?: "full" | "smoke" | "minimal";
};

export type RunSkillInput = {
  skillKey: string;
  inputSummary: string;
  context?: Record<string, unknown>;
  profile?: {
    skillDocMaxChars: number;
    maxCompletionTokensDefault: number;
    llmSkillFilter: "all" | "aios-prefix" | "none";
  };
};

export type NormalizedSkillOutput = {
  ok: boolean;
  data: Record<string, unknown>;
  raw?: string;
  normalizeError?: string;
};

export type WorkBreakdownDraft = {
  title: string;
  description?: string;
  targetArea: string;
  agentType: AgentType;
  riskLevel: "low" | "medium" | "high";
  estimatedHours: number;
  acceptanceCriteria?: string[];
  testCriteria?: string[];
};
