import { loadSkillMarkdown } from "./skill-loader";
import {
  buildChatCompletionRequestBody,
  extractChatCompletionText,
  getOpenAiApiKey,
  getOpenAiAuthHeaders,
  getOpenAiChatCompletionsUrl,
  getOpenAiModel,
} from "../openai-config";
import { shouldUseLiveLlmForSkill } from "./execution-profile";
import type { ExecutionMode, RunSkillInput } from "./types";

export const SKILL_PROMPT_VERSION = "phase13-v1";
export const SKILL_RUNNER_VERSION = "sprint2-v1";

export type SkillRunMetadata = {
  mode: ExecutionMode;
  openaiConfigured: boolean;
  fallbackReason?: string;
  model?: string;
  skillVersion?: string;
  promptVersion?: string;
};

function buildTemplateOutput(skillKey: string, inputSummary: string) {
  switch (skillKey) {
    case "analyze-feature-requests":
      return {
        label: "MOCK_PM_SKILL_EXECUTION",
        themes: ["core workflow", "integration"],
        summary: `Triaged request: ${inputSummary.slice(0, 120)}`,
      };
    case "prioritize-features":
      return {
        label: "MOCK_PM_SKILL_EXECUTION",
        prioritized: [{ name: inputSummary.slice(0, 80), score: 0.82 }],
      };
    case "create-prd":
      return {
        label: "MOCK_PM_SKILL_EXECUTION",
        title: inputSummary.slice(0, 100),
        sections: ["Summary", "Objective", "Solution", "Release"],
      };
    case "aios-impact-analysis":
      return {
        label: "MOCK_PM_SKILL_EXECUTION",
        requestType: "enhancement",
        overallRisk: inputSummary.length > 120 ? "medium" : "low",
        impacts: {
          db: { tables: [], migrationType: "additive" },
          ui: { routes: [], blocks: [] },
          modules: ["packages/automation/src/skills"],
          auth: { requiresJwt: false, requiresApproval: false },
        },
      };
    case "aios-work-breakdown":
      return {
        label: "MOCK_PM_SKILL_EXECUTION",
        items: [
          {
            title: `Implement ${inputSummary.slice(0, 60)}`,
            description: inputSummary,
            targetArea: "automation",
            agentType: "cursor",
            riskLevel: "medium",
            estimatedHours: 2,
            acceptanceCriteria: ["Feature works in dev", "Tests pass"],
            testCriteria: ["CI_INTEGRATION=1 pnpm test"],
          },
        ],
      };
    case "aios-agent-assignment":
      return {
        label: "MOCK_PM_SKILL_EXECUTION",
        assignments: [
          {
            itemTitle: `Implement ${inputSummary.slice(0, 60)}`,
            agentType: "cursor",
            rationale: "Portal integration work",
            priority: 1,
          },
        ],
      };
    case "aios-regression-recommendation":
      return {
        label: "MOCK_PM_SKILL_EXECUTION",
        recommendations: [
          {
            itemTitle: "Orchestrator flow",
            testType: "integration",
            command: "CI_INTEGRATION=1 pnpm --filter @ai-portal/automation test",
            acceptanceCriteria: ["phase13 orchestrator test passes"],
          },
        ],
      };
    case "aios-error-to-improvement":
      return {
        label: "MOCK_PM_SKILL_EXECUTION",
        symptom: inputSummary.slice(0, 200),
        improvementAction: {
          title: "Fix reported error",
          targetArea: "automation",
          agentType: "codex",
          priority: "high",
        },
      };
    default:
      return {
        label: "MOCK_PM_SKILL_EXECUTION",
        skillKey,
        summary: inputSummary.slice(0, 200),
      };
  }
}

async function callOpenAiSkillCompletion(
  skillKey: string,
  inputSummary: string,
  skillDoc: string,
  apiKey: string,
  model: string,
  input: RunSkillInput,
): Promise<Record<string, unknown>> {
  const maxCompletionTokens =
    skillKey === "aios-work-breakdown"
      ? Math.max(1024, input.profile?.maxCompletionTokensDefault ?? 2048)
      : input.profile?.maxCompletionTokensDefault;
  const skillDocMaxChars = input.profile?.skillDocMaxChars ?? 2000;

  async function performRequest() {
    return fetch(getOpenAiChatCompletionsUrl(), {
      method: "POST",
      headers: getOpenAiAuthHeaders(apiKey),
      body: JSON.stringify(
        buildChatCompletionRequestBody({
          model,
          jsonMode: true,
          maxCompletionTokens,
          messages: [
            {
              role: "system",
              content:
                "You are a PM skill executor. Return compact JSON only with fields: summary (string), items (optional array).",
            },
            {
              role: "user",
              content: `Skill: ${skillKey}\n\nSkill doc excerpt:\n${skillDoc.slice(0, skillDocMaxChars)}\n\nInput:\n${inputSummary}`,
            },
          ],
        }),
      ),
    });
  }

  let response = await performRequest();
  if (response.status === 429 || response.status >= 500) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    response = await performRequest();
  }

  if (!response.ok) {
    throw new Error(`openai_http_${response.status}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | null; reasoning_content?: string | null };
    }>;
  };
  const content = extractChatCompletionText(payload);
  if (!content) {
    throw new Error("openai_empty_content");
  }

  try {
    return JSON.parse(content) as Record<string, unknown>;
  } catch {
    return { summary: content, label: "LLM_PM_SKILL_EXECUTION" };
  }
}

export async function runSkillWithMetadata(
  input: RunSkillInput,
): Promise<{
  skillKey: string;
  executionMode: ExecutionMode;
  rawOutput: Record<string, unknown>;
  rawText: string;
  metadata: SkillRunMetadata;
}> {
  const templateBody = buildTemplateOutput(input.skillKey, input.inputSummary);
  const apiKey = getOpenAiApiKey();
  const model = getOpenAiModel();
  const baseMetadata: SkillRunMetadata = {
    mode: "template",
    openaiConfigured: Boolean(apiKey),
    skillVersion: SKILL_RUNNER_VERSION,
    promptVersion: SKILL_PROMPT_VERSION,
  };

  if (!apiKey) {
    const output = {
      ...templateBody,
      ...baseMetadata,
    };
    return {
      skillKey: input.skillKey,
      executionMode: "template",
      rawOutput: output,
      rawText: JSON.stringify(output, null, 2),
      metadata: { ...baseMetadata, openaiConfigured: false },
    };
  }

  if (!shouldUseLiveLlmForSkill(input.skillKey, input.profile ?? {
    llmSkillFilter: "all",
    maxCompletionTokensDefault: 2048,
    skillDocMaxChars: 2000,
  })) {
    const output = {
      ...templateBody,
      ...baseMetadata,
      openaiConfigured: true,
      fallbackReason: "profile_llm_disabled",
      model,
    };
    return {
      skillKey: input.skillKey,
      executionMode: "template",
      rawOutput: output,
      rawText: JSON.stringify(output, null, 2),
      metadata: {
        ...baseMetadata,
        openaiConfigured: true,
        fallbackReason: "profile_llm_disabled",
        model,
      },
    };
  }

  const skillDoc = loadSkillMarkdown(input.skillKey);
  if (!skillDoc) {
    const output = {
      ...templateBody,
      ...baseMetadata,
      openaiConfigured: true,
      fallbackReason: "skill_doc_missing",
    };
    return {
      skillKey: input.skillKey,
      executionMode: "template",
      rawOutput: output,
      rawText: JSON.stringify(output, null, 2),
      metadata: {
        ...baseMetadata,
        openaiConfigured: true,
        fallbackReason: "skill_doc_missing",
        model,
      },
    };
  }

  try {
    const llmPayload = await callOpenAiSkillCompletion(
      input.skillKey,
      input.inputSummary,
      skillDoc,
      apiKey,
      model,
      input,
    );
    const output = {
      label: "LLM_PM_SKILL_EXECUTION",
      ...llmPayload,
      ...baseMetadata,
      openaiConfigured: true,
      model,
    };
    return {
      skillKey: input.skillKey,
      executionMode: "llm",
      rawOutput: output,
      rawText: JSON.stringify(output, null, 2),
      metadata: {
        mode: "llm",
        openaiConfigured: true,
        model,
        skillVersion: SKILL_RUNNER_VERSION,
        promptVersion: SKILL_PROMPT_VERSION,
      },
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : "openai_call_failed";
    const output = {
      ...templateBody,
      ...baseMetadata,
      openaiConfigured: true,
      fallbackReason: reason,
      model,
    };
    return {
      skillKey: input.skillKey,
      executionMode: "template",
      rawOutput: output,
      rawText: JSON.stringify(output, null, 2),
      metadata: {
        mode: "template",
        openaiConfigured: true,
        fallbackReason: reason,
        model,
        skillVersion: SKILL_RUNNER_VERSION,
        promptVersion: SKILL_PROMPT_VERSION,
      },
    };
  }
}

export async function runSkill(input: RunSkillInput) {
  const result = await runSkillWithMetadata(input);
  return {
    skillKey: result.skillKey,
    executionMode: result.executionMode,
    rawOutput: result.rawOutput,
    rawText: result.rawText,
  };
}
