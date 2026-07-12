import { prisma as defaultPrisma } from "@sangfor/db";
import {
  buildChatCompletionRequestBody,
  extractChatCompletionText,
  getOpenAiApiKey,
  getOpenAiAuthHeaders,
  getOpenAiChatCompletionsUrl,
  getOpenAiModel,
  type ChatCompletionMessage,
} from "./openai-config";

type LlmMeteringPrisma = {
  llmCall: Pick<typeof defaultPrisma.llmCall, "create" | "findMany">;
};

export interface MeteredChatCompletionInput {
  caller: string;
  messages: Array<{ role: string; content: string }>;
  model?: string;
  jsonMode?: boolean;
  maxCompletionTokens?: number;
  fetchImpl?: typeof fetch;
  prismaClient?: LlmMeteringPrisma;
}

interface ChatCompletionUsagePayload {
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function recordLlmCall(
  prismaClient: LlmMeteringPrisma,
  data: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    caller: string;
    success: boolean;
  },
): Promise<void> {
  try {
    await prismaClient.llmCall.create({ data });
  } catch (error) {
    console.warn("llm-metering: failed to record llm call", error);
  }
}

export async function meteredChatCompletion(input: MeteredChatCompletionInput): Promise<string> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) throw new Error("no LLM key");

  const model = input.model ?? getOpenAiModel();
  const doFetch = input.fetchImpl ?? fetch;
  const prismaClient = input.prismaClient ?? defaultPrisma;
  const started = performance.now();

  try {
    const res = await doFetch(getOpenAiChatCompletionsUrl(), {
      method: "POST",
      headers: getOpenAiAuthHeaders(apiKey),
      body: JSON.stringify(
        buildChatCompletionRequestBody({
          model,
          messages: input.messages as ChatCompletionMessage[],
          jsonMode: input.jsonMode,
          maxCompletionTokens: input.maxCompletionTokens,
        }),
      ),
    });
    if (!res.ok) throw new Error(`llm_http_${res.status}`);
    const payload = (await res.json()) as ChatCompletionUsagePayload;
    const text = extractChatCompletionText(payload);
    if (!text) throw new Error("llm_empty_response");

    const latencyMs = Math.round(performance.now() - started);
    await recordLlmCall(prismaClient, {
      model,
      inputTokens: payload.usage?.prompt_tokens ?? 0,
      outputTokens: payload.usage?.completion_tokens ?? 0,
      latencyMs,
      caller: input.caller,
      success: true,
    });
    return text;
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    await recordLlmCall(prismaClient, {
      model,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs,
      caller: input.caller,
      success: false,
    });
    throw error;
  }
}

export interface LlmCallSummary {
  total: number;
  last24h: number;
  last7d: number;
  latencyP50: number;
  latencyP95: number;
  failureRate: number;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export async function summarizeLlmCalls(input?: {
  prismaClient?: LlmMeteringPrisma;
}): Promise<LlmCallSummary> {
  const prismaClient = input?.prismaClient ?? defaultPrisma;
  const rows = await prismaClient.llmCall.findMany({
    select: { latencyMs: true, success: true, createdAt: true },
  });

  const now = Date.now();
  const since24h = now - 24 * 60 * 60 * 1000;
  const since7d = now - 7 * 24 * 60 * 60 * 1000;

  const total = rows.length;
  const last24h = rows.filter((r) => r.createdAt.getTime() >= since24h).length;
  const last7d = rows.filter((r) => r.createdAt.getTime() >= since7d).length;
  const latencies = rows
    .map((r) => r.latencyMs)
    .filter((v): v is number => typeof v === "number")
    .sort((a, b) => a - b);
  const failures = rows.filter((r) => r.success === false).length;

  return {
    total,
    last24h,
    last7d,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    failureRate: total > 0 ? failures / total : 0,
  };
}
