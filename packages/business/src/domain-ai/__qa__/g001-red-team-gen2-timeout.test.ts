/**
 * G001 red-team QA — generation 2 delta (e599f5e..a4d52ef).
 * Attacks the NEW surface only: embedding-call deadline enforcement
 * (domain-embedder-openai.ts timeoutMs/AbortSignal.timeout) and its
 * precedence/fallback rules. Red-team only: no product source is modified.
 *
 * All tests use REAL timers with short bounded deadlines (20-50ms) — no
 * fake-timer reliance on AbortSignal.timeout's internal scheduling, and no
 * multi-second waits.
 */
import { describe, it, expect } from "vitest";
import { createOpenAiEmbedder, resolveEmbedder, describeEmbedder } from "../domain-embedder-openai";
import { safeEmbed } from "../domain-embedding";

/** Real-fetch-shaped mock: never resolves on its own, only rejects when the AbortSignal fires. */
function hangingFetch(): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      if (signal?.aborted) {
        reject(new Error("aborted by deadline"));
        return;
      }
      signal?.addEventListener("abort", () => reject(new Error("aborted by deadline")));
    })) as unknown as typeof fetch;
}

/** Real-fetch-shaped mock: resolves successfully after `delayMs`, but rejects immediately if aborted first. */
function delayedOkFetch(delayMs: number, vector: number[]): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          resolve({
            ok: true,
            status: 200,
            statusText: "",
            json: async () => ({ data: [{ embedding: vector }] }),
          } as Response),
        delayMs,
      );
      const signal = init?.signal as AbortSignal | undefined;
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted by deadline"));
      });
    })) as unknown as typeof fetch;
}

function elapsedUnder(startedAt: number, boundMs: number) {
  expect(Date.now() - startedAt).toBeLessThan(boundMs);
}

describe("G001 red-team gen2: deadline enforcement (case 1)", () => {
  it("OPENAI_API_KEY branch: a hanging fetch aborts at timeoutMs, rejects, and safeEmbed degrades to null", async () => {
    const embed = createOpenAiEmbedder({
      apiKey: "sk-x",
      baseUrl: "http://openai-branch.local/v1",
      fetchImpl: hangingFetch(),
      timeoutMs: 25,
    });
    const start = Date.now();
    await expect(embed("probe")).rejects.toThrow();
    elapsedUnder(start, 500); // bounded — proves the call path does not hang
    expect(await safeEmbed(embed, "probe")).toBeNull();
  });

  it("EMBEDDING_BASE_URL (embedding-endpoint) branch: timeoutMs survives embeddingEndpoint() and aborts a hanging call", async () => {
    const opts = { baseUrl: "http://embed-branch.local/v1", timeoutMs: 25, fetchImpl: hangingFetch() };
    // sanity: confirm we are actually exercising the embedding-endpoint resolver branch
    expect(describeEmbedder(opts)).toBe("embedding-endpoint");

    const embed = resolveEmbedder(opts);
    const start = Date.now();
    await expect(embed("probe")).rejects.toThrow();
    elapsedUnder(start, 500);
    expect(await safeEmbed(embed, "probe")).toBeNull();
  });

  it("EMBEDDING_BASE_URL branch via resolveEmbedder() with no explicit apiKey still enforces the deadline (ollama-style anonymous endpoint)", async () => {
    const embed = resolveEmbedder({ baseUrl: "http://embed-branch2.local/v1", timeoutMs: 20, fetchImpl: hangingFetch() });
    const start = Date.now();
    await expect(embed("probe")).rejects.toThrow();
    elapsedUnder(start, 500);
  });
});

describe("G001 red-team gen2: timeout config precedence (case 2)", () => {
  it("explicit opts.timeoutMs beats a much larger EMBEDDING_TIMEOUT_MS env value", async () => {
    process.env.EMBEDDING_TIMEOUT_MS = "5000";
    try {
      // if the env value (5000ms) won, this response at 150ms would resolve successfully;
      // the explicit opts.timeoutMs=20 must abort well before that.
      const embed = createOpenAiEmbedder({
        apiKey: "sk-x",
        baseUrl: "http://precedence.local/v1",
        fetchImpl: delayedOkFetch(150, [1, 2, 3]),
        timeoutMs: 20,
      });
      const start = Date.now();
      await expect(embed("probe")).rejects.toThrow();
      elapsedUnder(start, 140); // must abort before the 150ms response would have arrived
    } finally {
      delete process.env.EMBEDDING_TIMEOUT_MS;
    }
  });

  it.each([
    ["unset", undefined],
    ["garbage string", "not-a-number"],
    ["zero", "0"],
    ["negative", "-500"],
    ["whitespace", "   "],
  ])(
    "EMBEDDING_TIMEOUT_MS=%s falls back to the 10s default, NOT 0/NaN (a 40ms response still succeeds)",
    async (_label, envValue) => {
      if (envValue === undefined) delete process.env.EMBEDDING_TIMEOUT_MS;
      else process.env.EMBEDDING_TIMEOUT_MS = envValue;
      try {
        // no opts.timeoutMs — must resolve via the env-fallback path. A 0/NaN deadline
        // (ToUnsignedLong(NaN) === 0) would abort near-instantly and this fetch — which
        // only resolves after 40ms — would never get the chance to.
        const embed = createOpenAiEmbedder({
          apiKey: "sk-x",
          baseUrl: "http://fallback.local/v1",
          fetchImpl: delayedOkFetch(40, [9, 9, 9]),
        });
        await expect(embed("probe")).resolves.toEqual([9, 9, 9]);
      } finally {
        delete process.env.EMBEDDING_TIMEOUT_MS;
      }
    },
  );

  it("[finding] explicit timeoutMs=0 is honored verbatim (no floor applied) — current behavior is asymmetric with the env-fallback guard, documented as a non-blocking finding; no production caller passes timeoutMs today", async () => {
    const embed = createOpenAiEmbedder({
      apiKey: "sk-x",
      baseUrl: "http://zero-timeout.local/v1",
      fetchImpl: delayedOkFetch(50, [1, 2, 3]),
      timeoutMs: 0,
    });
    // documents observed behavior: an explicit 0 aborts before the 50ms response arrives,
    // unlike EMBEDDING_TIMEOUT_MS=0 which is validated and floored to 10s.
    await expect(embed("probe")).rejects.toThrow();
  });
});

describe("G001 red-team gen2: happy path — no regression (case 3)", () => {
  it("a normal fetch that resolves before the deadline still returns the vector, with default timeout unset", async () => {
    const embed = createOpenAiEmbedder({
      apiKey: "sk-x",
      baseUrl: "http://happy.local/v1",
      fetchImpl: delayedOkFetch(5, [0.4, 0.5, 0.6]),
    });
    const start = Date.now();
    await expect(embed("probe")).resolves.toEqual([0.4, 0.5, 0.6]);
    elapsedUnder(start, 500); // default 10s deadline never engages on a fast response
  });

  it("leaves no dangling abort effect: repeated calls on the same embedder each succeed independently", async () => {
    const embed = createOpenAiEmbedder({
      apiKey: "sk-x",
      baseUrl: "http://happy2.local/v1",
      fetchImpl: delayedOkFetch(5, [1, 1, 1]),
      timeoutMs: 200,
    });
    await expect(embed("a")).resolves.toEqual([1, 1, 1]);
    await expect(embed("b")).resolves.toEqual([1, 1, 1]);
    await expect(embed("c")).resolves.toEqual([1, 1, 1]);
  });

  it("safeEmbed passes the vector through unchanged on the happy path (no degradation)", async () => {
    const embed = createOpenAiEmbedder({
      apiKey: "sk-x",
      baseUrl: "http://happy3.local/v1",
      fetchImpl: delayedOkFetch(5, [7, 8, 9]),
    });
    expect(await safeEmbed(embed, "probe")).toEqual([7, 8, 9]);
  });
});
