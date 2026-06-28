/**
 * @sangfor/agent — shared types for the MCP tool-calling agent.
 *
 * The agent uses a JSON-mode ReAct loop (not native OpenAI function-calling),
 * because the configured LLM endpoint (MiMo OpenAI-compatible) supports
 * response_format json_object but not the `tools` parameter.
 */

export interface AgentMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** A tool the agent may call — typically sourced from the MCP bridge /tools. */
export interface AgentTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/** Returns the raw text/JSON completion for a conversation. */
export type LlmComplete = (messages: AgentMessage[]) => Promise<string>;

/** Result envelope from executing a tool (mirrors the MCP bridge response). */
export interface ToolExecResult {
  result?: unknown;
  error?: string;
  allowedTools?: string[];
}

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<ToolExecResult>;

export type AgentStepKind = "tool" | "final" | "blocked" | "error";

export interface AgentStep {
  index: number;
  kind: AgentStepKind;
  /** Raw LLM output for this step (for trace/audit). */
  raw?: string;
  thought?: string;
  tool?: string;
  arguments?: Record<string, unknown>;
  /** Tool result (or error envelope) fed back to the model. */
  observation?: unknown;
  error?: string;
  latencyMs?: number;
}

export type AgentStatus = "completed" | "max_steps" | "blocked" | "error";

export interface AgentRunResult {
  goal: string;
  status: AgentStatus;
  answer?: string;
  steps: AgentStep[];
  /** Set when status === "blocked": the unsafe tool awaiting approval. */
  blockedTool?: string;
  blockedArguments?: Record<string, unknown>;
}

export interface RunAgentOptions {
  goal: string;
  tools: AgentTool[];
  llm: LlmComplete;
  execute: ToolExecutor;
  /** Max LLM turns before giving up. Default 6. */
  maxSteps?: number;
  /** Tools allowed to auto-execute. Others are blocked unless allowUnsafe. */
  safeTools?: string[];
  /** Bypass the safe-tool gate (e.g. after human approval). Default false. */
  allowUnsafe?: boolean;
  /** Override the system prompt entirely (advanced). */
  systemPrompt?: string;
  /** Injectable clock for deterministic latency in tests. Default Date.now. */
  now?: () => number;
  /** Called as each step is recorded — enables streaming UIs later. */
  onStep?: (step: AgentStep) => void;
}
