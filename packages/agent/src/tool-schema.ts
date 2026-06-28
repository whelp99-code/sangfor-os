import type { AgentTool } from "./types";

/** Render the available tools as a compact, model-readable catalog. */
export function describeTools(tools: AgentTool[]): string {
  if (tools.length === 0) return "(no tools available)";
  return tools
    .map((t) => {
      const schema =
        t.inputSchema != null ? `\n   input: ${JSON.stringify(t.inputSchema)}` : "";
      return `- ${t.name}${t.description ? `: ${t.description}` : ""}${schema}`;
    })
    .join("\n");
}

/** Default system prompt establishing the JSON ReAct protocol. */
export function buildSystemPrompt(tools: AgentTool[]): string {
  return [
    "You are the Sangfor Engineer Agent. Achieve the user's goal by calling tools and reasoning over their results.",
    "",
    "Available tools:",
    describeTools(tools),
    "",
    "Respond with a SINGLE JSON object and nothing else. Use exactly one of these forms:",
    '1) Call a tool: {"action":"tool","tool":"<tool name>","arguments":{...},"thought":"<one short sentence>"}',
    '2) Finish:      {"action":"final","answer":"<answer for the user>"}',
    "",
    "Rules:",
    "- Only call tools from the list above, with arguments matching their input schema.",
    "- After each tool call you will receive an Observation. Use it before deciding the next step.",
    "- When you have enough information, return action \"final\". Base the answer only on observations.",
    "- Never invent tool results. Keep arguments minimal and valid JSON.",
  ].join("\n");
}

export type ParsedAction =
  | { kind: "tool"; tool: string; arguments: Record<string, unknown>; thought?: string }
  | { kind: "final"; answer: string };

/** Validate a parsed JSON object into a typed agent action. Throws on malformed input. */
export function toAction(obj: unknown): ParsedAction {
  if (!obj || typeof obj !== "object") {
    throw new Error("action is not an object");
  }
  const record = obj as Record<string, unknown>;
  const action = record.action;

  if (action === "final") {
    return { kind: "final", answer: String(record.answer ?? "") };
  }

  if (action === "tool") {
    const tool = typeof record.tool === "string" ? record.tool : "";
    if (!tool) throw new Error('action "tool" requires a string "tool" field');
    const args =
      record.arguments && typeof record.arguments === "object" && !Array.isArray(record.arguments)
        ? (record.arguments as Record<string, unknown>)
        : {};
    const thought = typeof record.thought === "string" ? record.thought : undefined;
    return { kind: "tool", tool, arguments: args, thought };
  }

  throw new Error(`unknown action: ${String(action)}`);
}
