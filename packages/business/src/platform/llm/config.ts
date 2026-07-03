/** Centralised LLM config resolution — API key, base URL, and model from DB/env/default. */

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  source: "db" | "env" | "default";
}

export function resolveLlmConfig(
  stack: "openai" | "opencode",
  dbConfig?: { apiKey?: string; baseUrl?: string; model?: string },
): LlmConfig {
  const source: LlmConfig["source"] = dbConfig?.apiKey ? "db" : "env";

  if (stack === "openai") {
    return {
      apiKey: dbConfig?.apiKey || process.env.OPENAI_API_KEY || "",
      baseUrl: dbConfig?.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
      model: dbConfig?.model || process.env.OPENAI_MODEL || "gpt-4o-mini",
      source,
    };
  }

  if (stack === "opencode") {
    return {
      apiKey: dbConfig?.apiKey || process.env.OPENCODE_API_KEY || "",
      baseUrl: dbConfig?.baseUrl || process.env.OPENCODE_BASE_URL || "https://api.opencode.ai/v1",
      model: dbConfig?.model || process.env.OPENCODE_MODEL || "gpt-5",
      source,
    };
  }

  throw new Error(`Unknown LLM stack: ${stack}`);
}

export function detectLlmStack(apiKey: string): "openai" | "opencode" {
  if (apiKey.startsWith("sk-")) return "openai";
  if (apiKey.startsWith("tp-")) return "opencode";
  return "openai";
}
