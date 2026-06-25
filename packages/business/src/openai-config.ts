/** OpenAI-compatible LLM endpoints (OpenAI, Xiaomi MiMo, etc.) */

const MIMO_PAYGO_BASE = "https://api.xiaomimimo.com/v1";
const MIMO_TOKEN_PLAN_SGP_BASE = "https://token-plan-sgp.xiaomimimo.com/v1";
const OPENAI_DEFAULT_BASE = "https://api.openai.com/v1";

export function getOpenAiApiKey(): string | undefined {
  const key = process.env.OPENAI_API_KEY?.trim();
  return key || undefined;
}

export function isMimoApiKey(apiKey?: string): boolean {
  const key = apiKey ?? getOpenAiApiKey();
  return Boolean(key?.startsWith("tp-") || key?.startsWith("sk-"));
}

export function isMimoBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes("xiaomimimo.com");
}

/** Resolve base URL; MiMo sk-/tp- keys auto-map to the correct cluster per official docs. */
export function resolveOpenAiBaseUrl(): string {
  const explicit = process.env.OPENAI_BASE_URL?.trim().replace(/\/$/, "");
  const key = getOpenAiApiKey();

  if (key?.startsWith("sk-")) {
    if (explicit && isMimoBaseUrl(explicit) && !explicit.includes("api.xiaomimimo.com")) {
      return MIMO_PAYGO_BASE;
    }
    return explicit || MIMO_PAYGO_BASE;
  }

  if (key?.startsWith("tp-")) {
    if (explicit && isMimoBaseUrl(explicit)) {
      return explicit;
    }
    return explicit || MIMO_TOKEN_PLAN_SGP_BASE;
  }

  return explicit || OPENAI_DEFAULT_BASE;
}

export function getOpenAiBaseUrl(): string {
  return resolveOpenAiBaseUrl();
}

export function getOpenAiChatCompletionsUrl(): string {
  return `${getOpenAiBaseUrl()}/chat/completions`;
}

export function getOpenAiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

/**
 * MiMo OpenAI API auth — pick one header per official docs:
 * https://platform.xiaomimimo.com/docs/en-US/api/chat/openai-api
 */
export function getOpenAiAuthHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isMimoBaseUrl(getOpenAiBaseUrl())) {
    headers["api-key"] = apiKey;
  } else {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

export type ChatCompletionMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

/** Build request body aligned with MiMo OpenAI-compatible API when applicable. */
export function buildChatCompletionRequestBody(input: {
  model: string;
  messages: ChatCompletionMessage[];
  jsonMode?: boolean;
  maxCompletionTokens?: number;
}): Record<string, unknown> {
  const mimo = isMimoBaseUrl(getOpenAiBaseUrl());
  const envMax = process.env.OPENAI_MAX_COMPLETION_TOKENS?.trim();
  const parsedMax = envMax ? Number.parseInt(envMax, 10) : NaN;
  const maxTokens =
    Number.isFinite(parsedMax) && parsedMax > 0
      ? parsedMax
      : input.maxCompletionTokens ?? (mimo ? 4096 : 2048);

  if (mimo) {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      max_completion_tokens: maxTokens,
      temperature: 1.0,
      top_p: 0.95,
      stream: false,
      stop: null,
      frequency_penalty: 0,
      presence_penalty: 0,
      thinking: { type: "disabled" },
    };
    if (input.jsonMode) {
      body.response_format = { type: "json_object" };
    }
    return body;
  }

  const body: Record<string, unknown> = {
    model: input.model,
    messages: input.messages,
    max_tokens: maxTokens,
    temperature: 0.2,
    stream: false,
  };
  if (input.jsonMode) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

export function extractChatCompletionText(payload: {
  choices?: Array<{
    message?: { content?: string | null; reasoning_content?: string | null };
  }>;
}): string | undefined {
  const message = payload.choices?.[0]?.message;
  const content = message?.content?.trim();
  if (content) {
    return content;
  }
  return message?.reasoning_content?.trim() || undefined;
}

export function describeOpenAiKeyProfile():
  | { ok: true; resolvedBaseUrl: string; note?: string }
  | { ok: false; reason: string } {
  const key = getOpenAiApiKey();
  const explicit = process.env.OPENAI_BASE_URL?.trim().replace(/\/$/, "") || "";
  const resolved = resolveOpenAiBaseUrl();

  if (!key) {
    return { ok: false, reason: "OPENAI_API_KEY is unset" };
  }

  if (key.startsWith("sk-") && explicit.includes("token-plan")) {
    return {
      ok: true,
      resolvedBaseUrl: resolved,
      note:
        "sk- key uses pay-as-you-go base https://api.xiaomimimo.com/v1 (token-plan URL ignored)",
    };
  }

  if (key.startsWith("tp-") && explicit.includes("api.xiaomimimo.com")) {
    return {
      ok: false,
      reason:
        "Token Plan key (tp-) requires token-plan-* base URL from Subscription page",
    };
  }

  if (key.startsWith("tp-") && explicit && !explicit.includes("token-plan")) {
    return {
      ok: false,
      reason:
        "Token Plan key (tp-) requires OPENAI_BASE_URL from Subscription (token-plan-*)",
    };
  }

  return { ok: true, resolvedBaseUrl: resolved };
}
