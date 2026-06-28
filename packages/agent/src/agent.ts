import { extractJsonObject } from "./json-extract";
import { buildSystemPrompt, toAction } from "./tool-schema";
import type {
  AgentMessage,
  AgentRunResult,
  AgentStep,
  RunAgentOptions,
} from "./types";

const DEFAULT_MAX_STEPS = 6;

/**
 * Run the MCP tool-calling agent loop.
 *
 * Each iteration: ask the LLM for a JSON action, then either finish, call a
 * tool (feeding the observation back), block an unsafe tool for approval, or
 * retry on malformed output. All dependencies (llm, execute) are injected, so
 * the loop is fully unit-testable without a network, LLM, or running MCP bridge.
 */
export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const {
    goal,
    tools,
    llm,
    execute,
    maxSteps = DEFAULT_MAX_STEPS,
    safeTools,
    allowUnsafe = false,
    systemPrompt,
    now = () => Date.now(),
    onStep,
  } = opts;

  const steps: AgentStep[] = [];
  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt ?? buildSystemPrompt(tools) },
    { role: "user", content: goal },
  ];

  const record = (step: AgentStep): AgentStep => {
    steps.push(step);
    onStep?.(step);
    return step;
  };

  const isSafe = (tool: string) =>
    allowUnsafe || !safeTools || safeTools.includes(tool);

  for (let index = 0; index < maxSteps; index++) {
    const raw = await llm(messages);

    let action;
    try {
      action = toAction(extractJsonObject(raw));
    } catch (error) {
      record({
        index,
        kind: "error",
        raw,
        error: error instanceof Error ? error.message : String(error),
      });
      // Give the model a chance to correct itself within the step budget.
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content:
          "Your response was not a single valid JSON object. Reply with one JSON object per the protocol.",
      });
      continue;
    }

    if (action.kind === "final") {
      record({ index, kind: "final", raw, observation: action.answer });
      return { goal, status: "completed", answer: action.answer, steps };
    }

    // action.kind === "tool"
    if (!isSafe(action.tool)) {
      record({
        index,
        kind: "blocked",
        raw,
        tool: action.tool,
        arguments: action.arguments,
        thought: action.thought,
      });
      return {
        goal,
        status: "blocked",
        steps,
        blockedTool: action.tool,
        blockedArguments: action.arguments,
      };
    }

    const started = now();
    const exec = await execute(action.tool, action.arguments);
    const latencyMs = now() - started;
    const observation = exec.error
      ? { error: exec.error, allowedTools: exec.allowedTools }
      : exec.result;

    record({
      index,
      kind: exec.error ? "error" : "tool",
      raw,
      tool: action.tool,
      arguments: action.arguments,
      thought: action.thought,
      observation,
      error: exec.error,
      latencyMs,
    });

    messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content: `Observation (${action.tool}): ${JSON.stringify(observation)}`,
    });
  }

  return { goal, status: "max_steps", steps };
}
