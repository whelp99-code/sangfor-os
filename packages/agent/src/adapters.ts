/**
 * Real dependency adapters wiring the agent core to:
 *  - the OpenAI-compatible LLM (@sangfor/business/openai-config, MiMo-aware)
 *  - the MCP HTTP bridge tools (@sangfor/infra)
 */

import {
  buildChatCompletionRequestBody,
  extractChatCompletionText,
  getOpenAiApiKey,
  getOpenAiAuthHeaders,
  getOpenAiChatCompletionsUrl,
  getOpenAiModel,
  type ChatCompletionMessage,
} from "@sangfor/business/openai-config";
import { callMcpTool, listMcpTools } from "@sangfor/infra";

import type { AgentTool, LlmComplete, ToolExecutor } from "./types";

/** The bridge's read-only safe-tool whitelist (mirrors http-bridge SAFE_TOOL_WHITELIST). */
export const SAFE_MCP_TOOLS = [
  "sangfor.products",
  "sangfor.search_manuals",
  "sangfor.get_manual_section",
  "sangfor.rag_search",
  "sangfor.rag_index_summary",
  "sangfor.store_health",
];

/** Build an LlmComplete backed by the configured OpenAI-compatible endpoint. */
export function createOpenAiLlm(opts: { jsonMode?: boolean; fetchImpl?: typeof fetch } = {}): LlmComplete {
  const doFetch = opts.fetchImpl ?? fetch;
  return async (messages) => {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

    const body = buildChatCompletionRequestBody({
      model: getOpenAiModel(),
      messages: messages as ChatCompletionMessage[],
      jsonMode: opts.jsonMode ?? true,
    });

    const res = await doFetch(getOpenAiChatCompletionsUrl(), {
      method: "POST",
      headers: getOpenAiAuthHeaders(apiKey),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`LLM request failed: HTTP ${res.status}`);
    }
    const payload = await res.json();
    const text = extractChatCompletionText(payload);
    if (!text) throw new Error("LLM returned an empty completion");
    return text;
  };
}

/** List the MCP bridge tools as AgentTools. */
export async function listMcpAgentTools(): Promise<AgentTool[]> {
  const tools = await listMcpTools();
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

/** Execute an MCP tool through the bridge. */
export const executeMcpTool: ToolExecutor = (name, args) => callMcpTool(name, args);
