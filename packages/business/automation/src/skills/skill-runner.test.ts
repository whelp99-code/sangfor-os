import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("skill-runner metadata", () => {
  const originalKey = process.env.OPENAI_API_KEY;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.OPENAI_API_KEY = originalKey;
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
  });

  it("uses template mode when OPENAI_API_KEY is unset", async () => {
    delete process.env.OPENAI_API_KEY;
    const { runSkillWithMetadata } = await import("./skill-runner");
    const result = await runSkillWithMetadata({
      skillKey: "create-prd",
      inputSummary: "Add export feature for customers",
    });
    expect(result.executionMode).toBe("template");
    expect(result.metadata.openaiConfigured).toBe(false);
    expect(result.metadata.mode).toBe("template");
  });

  it("records openaiConfigured when key is set but falls back on API failure", async () => {
    process.env.OPENAI_API_KEY = "test-key-mock";
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network_down")) as typeof fetch;

    const { runSkillWithMetadata } = await import("./skill-runner");
    const result = await runSkillWithMetadata({
      skillKey: "create-prd",
      inputSummary: "Add export feature for customers",
    });

    expect(result.executionMode).toBe("template");
    expect(result.metadata.openaiConfigured).toBe(true);
    expect(result.metadata.fallbackReason).toBeTruthy();
    expect(result.rawOutput.openaiConfigured).toBe(true);
  });
});
