import { runAgent } from "./agent";
import {
  SAFE_MCP_TOOLS,
  createOpenAiLlm,
  executeMcpTool,
  listMcpAgentTools,
} from "./adapters";
import type { AgentRunResult, AgentStep, AgentTool, LlmComplete, ToolExecutor } from "./types";

export { runAgent } from "./agent";
export { extractJsonObject } from "./json-extract";
export { buildSystemPrompt, describeTools, toAction } from "./tool-schema";
export {
  SAFE_MCP_TOOLS,
  createOpenAiLlm,
  executeMcpTool,
  listMcpAgentTools,
} from "./adapters";
export type {
  AgentMessage,
  AgentRunResult,
  AgentStatus,
  AgentStep,
  AgentStepKind,
  AgentTool,
  LlmComplete,
  RunAgentOptions,
  ToolExecResult,
  ToolExecutor,
} from "./types";

export interface RunMcpAgentInput {
  goal: string;
  maxSteps?: number;
  /** Bypass the safe-tool whitelist (e.g. after human approval). */
  allowUnsafe?: boolean;
  onStep?: (step: AgentStep) => void;
  /** Overrides for testing / custom wiring. */
  tools?: AgentTool[];
  llm?: LlmComplete;
  execute?: ToolExecutor;
}

/**
 * Convenience entry point: run the agent against the live MCP bridge using the
 * configured OpenAI-compatible LLM, with the read-only safe-tool whitelist
 * enforced by default. Any dependency can be overridden for tests.
 */
export async function runMcpAgent(input: RunMcpAgentInput): Promise<AgentRunResult> {
  const tools = input.tools ?? (await listMcpAgentTools());
  return runAgent({
    goal: input.goal,
    tools,
    llm: input.llm ?? createOpenAiLlm({ jsonMode: true }),
    execute: input.execute ?? executeMcpTool,
    safeTools: SAFE_MCP_TOOLS,
    allowUnsafe: input.allowUnsafe ?? false,
    maxSteps: input.maxSteps,
    onStep: input.onStep,
  });
}
