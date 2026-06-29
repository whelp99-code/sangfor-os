import { describe, it, expect, vi } from "vitest";
import { withBackoff, mapPool, reclassifyDomainsWithAI } from "./ai-classify-batch";

// ---------------------------------------------------------------------------
// withBackoff
// ---------------------------------------------------------------------------

describe("withBackoff", () => {
  it("succeeds first try", async () => {
    const sleep = vi.fn(async () => {});
    const result = await withBackoff(async () => "hello", { sleep });
    expect(result).toBe("hello");
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries on retryable error then succeeds", async () => {
    let calls = 0;
    const fn = async () => {
      calls += 1;
      if (calls <= 2) throw new Error("429 rate limit");
      return "ok";
    };
    const result = await withBackoff(fn, { sleep: async () => {} });
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws after exhausting retries", async () => {
    const fn = async () => {
      throw new Error("429");
    };
    await expect(
      withBackoff(fn, { retries: 2, sleep: async () => {} }),
    ).rejects.toThrow("429");
  });

  it("non-retryable error throws immediately", async () => {
    const sleep = vi.fn(async () => {});
    const fn = async () => {
      throw new Error("bad input");
    };
    await expect(withBackoff(fn, { sleep })).rejects.toThrow("bad input");
    expect(sleep).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// mapPool
// ---------------------------------------------------------------------------

describe("mapPool", () => {
  it("concurrency respected", async () => {
    const concurrency = 2;
    let inFlight = 0;
    const items = [0, 1, 2, 3, 4];
    const results = await mapPool(items, concurrency, async (item) => {
      inFlight += 1;
      expect(inFlight).toBeLessThanOrEqual(concurrency);
      // Yield so concurrent workers can start
      await Promise.resolve();
      inFlight -= 1;
      return item;
    });
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("order preserved", async () => {
    const items = [4, 3, 2, 1, 0];
    const results = await mapPool(items, 3, async (item) => item * 10);
    expect((results[0] as { ok: true; value: number }).value).toBe(40);
    expect((results[4] as { ok: true; value: number }).value).toBe(0);
  });

  it("per-item failure captured", async () => {
    const items = [1, 2, 3];
    const results = await mapPool(items, 2, async (item) => {
      if (item === 2) throw new Error("boom");
      return item;
    });
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[1]).toMatchObject({
      ok: false,
      error: expect.stringContaining("boom"),
    });
    expect(results[2]).toMatchObject({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// reclassifyDomainsWithAI
// ---------------------------------------------------------------------------

describe("reclassifyDomainsWithAI", () => {
  it("retries 429 then succeeds", async () => {
    const classifyOne = vi.fn(async (domain: string) => {
      if (domain === "a.com" && classifyOne.mock.calls.filter((c) => c[0] === "a.com").length === 1) {
        throw new Error("429");
      }
      return { domain, type: "customer", confidence: 90 };
    });

    const { results, failed } = await reclassifyDomainsWithAI(
      ["a.com", "b.com", "c.com"],
      classifyOne,
      { _backoffOpts: { sleep: async () => {} } },
    );

    expect(results.length).toBe(3);
    expect(failed.length).toBe(0);
  });

  it("always-failing domain goes to failed", async () => {
    const classifyOne = vi.fn(async (domain: string) => {
      if (domain === "fail.com") throw new Error("429");
      return { domain, type: "customer", confidence: 90 };
    });

    const { results, failed } = await reclassifyDomainsWithAI(
      ["ok.com", "fail.com"],
      classifyOne,
      { _backoffOpts: { retries: 2, sleep: async () => {} } },
    );

    expect(results.length).toBe(1);
    expect(results[0].domain).toBe("ok.com");
    expect(failed).toEqual(["fail.com"]);
  });
});
