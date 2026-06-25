import { afterEach, describe, expect, it } from "vitest";

import {
  buildChatCompletionRequestBody,
  describeOpenAiKeyProfile,
  extractChatCompletionText,
  getOpenAiBaseUrl,
  getOpenAiChatCompletionsUrl,
  getOpenAiModel,
  resolveOpenAiBaseUrl,
} from "./openai-config";

describe("openai-config", () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  it("defaults to OpenAI when unset", () => {
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_MODEL;
    delete process.env.OPENAI_API_KEY;
    expect(getOpenAiBaseUrl()).toBe("https://api.openai.com/v1");
    expect(getOpenAiChatCompletionsUrl()).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(getOpenAiModel()).toBe("gpt-4o-mini");
  });

  it("resolves sk- key to MiMo pay-as-you-go base URL", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = "https://token-plan-sgp.xiaomimimo.com/v1";
    expect(resolveOpenAiBaseUrl()).toBe("https://api.xiaomimimo.com/v1");
  });

  it("builds MiMo request body per official OpenAI-compatible API", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = "https://api.xiaomimimo.com/v1";
    const body = buildChatCompletionRequestBody({
      model: "mimo-v2.5-pro",
      jsonMode: true,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(body).toMatchObject({
      model: "mimo-v2.5-pro",
      max_completion_tokens: 4096,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      stream: false,
    });
    expect(body).not.toHaveProperty("max_tokens");
  });

  it("extracts content from MiMo chat completion response", () => {
    expect(
      extractChatCompletionText({
        choices: [{ message: { content: "  {\"ok\":true}  " } }],
      }),
    ).toBe('{"ok":true}');
  });

  it("describes sk- + token-plan mismatch as auto-resolved", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_BASE_URL = "https://token-plan-sgp.xiaomimimo.com/v1";
    expect(describeOpenAiKeyProfile()).toEqual({
      ok: true,
      resolvedBaseUrl: "https://api.xiaomimimo.com/v1",
      note: expect.stringContaining("pay-as-you-go"),
    });
  });
});
