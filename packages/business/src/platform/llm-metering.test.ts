import { afterEach, describe, expect, it, vi } from "vitest";

import { meteredChatCompletion, summarizeLlmCalls } from "./llm-metering";

describe("llm-metering", () => {
  const env = process.env;

  afterEach(() => {
    process.env = { ...env };
  });

  describe("meteredChatCompletion", () => {
    it("records a successful call and returns the completion text", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      delete process.env.OPENAI_BASE_URL;

      const fetchImpl = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: "hello there" } }],
          usage: { prompt_tokens: 12, completion_tokens: 34 },
        }),
      });
      const create = vi.fn().mockResolvedValue({});
      const prismaClient = { llmCall: { create, findMany: vi.fn() } };

      const text = await meteredChatCompletion({
        caller: "test:caller",
        model: "gpt-test",
        messages: [{ role: "user", content: "hi" }],
        fetchImpl: fetchImpl as unknown as typeof fetch,
        prismaClient,
      });

      expect(text).toBe("hello there");
      expect(create).toHaveBeenCalledTimes(1);
      const call = create.mock.calls[0][0].data;
      expect(call.model).toBe("gpt-test");
      expect(call.inputTokens).toBe(12);
      expect(call.outputTokens).toBe(34);
      expect(call.caller).toBe("test:caller");
      expect(call.success).toBe(true);
      expect(typeof call.latencyMs).toBe("number");
    });

    it("records a failed call and rethrows when fetch fails", async () => {
      process.env.OPENAI_API_KEY = "sk-test";
      delete process.env.OPENAI_BASE_URL;

      const fetchImpl = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      });
      const create = vi.fn().mockResolvedValue({});
      const prismaClient = { llmCall: { create, findMany: vi.fn() } };

      await expect(
        meteredChatCompletion({
          caller: "test:caller",
          model: "gpt-test",
          messages: [{ role: "user", content: "hi" }],
          fetchImpl: fetchImpl as unknown as typeof fetch,
          prismaClient,
        }),
      ).rejects.toThrow();

      expect(create).toHaveBeenCalledTimes(1);
      const call = create.mock.calls[0][0].data;
      expect(call.success).toBe(false);
      expect(call.inputTokens).toBe(0);
      expect(call.outputTokens).toBe(0);
      expect(call.caller).toBe("test:caller");
    });

    it("throws before calling fetch when no API key is configured", async () => {
      delete process.env.OPENAI_API_KEY;

      const fetchImpl = vi.fn();
      const create = vi.fn();
      const prismaClient = { llmCall: { create, findMany: vi.fn() } };

      await expect(
        meteredChatCompletion({
          caller: "test:caller",
          messages: [{ role: "user", content: "hi" }],
          fetchImpl: fetchImpl as unknown as typeof fetch,
          prismaClient,
        }),
      ).rejects.toThrow();

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe("summarizeLlmCalls", () => {
    it("computes p50/p95 latency and failure rate from stored rows", async () => {
      const now = Date.now();
      const rows = Array.from({ length: 10 }, (_, i) => ({
        latencyMs: (i + 1) * 100,
        success: i < 8,
        createdAt: new Date(now - i * 1000),
      }));
      const findMany = vi.fn().mockResolvedValue(rows);
      const prismaClient = { llmCall: { create: vi.fn(), findMany } };

      const summary = await summarizeLlmCalls({ prismaClient });

      expect(summary.total).toBe(10);
      expect(summary.failureRate).toBeCloseTo(0.2);
      expect(summary.latencyP50).toBe(600);
      expect(summary.latencyP95).toBe(1000);
    });

    it("returns zeros when there are no rows", async () => {
      const findMany = vi.fn().mockResolvedValue([]);
      const prismaClient = { llmCall: { create: vi.fn(), findMany } };

      const summary = await summarizeLlmCalls({ prismaClient });

      expect(summary).toEqual({
        total: 0,
        last24h: 0,
        last7d: 0,
        latencyP50: 0,
        latencyP95: 0,
        failureRate: 0,
      });
    });
  });
});
