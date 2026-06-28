import { describe, expect, it, vi } from "vitest";

import { CircuitBreaker, HttpStatusError, defaultShouldRetry, withRetry } from "./resilience";

describe("withRetry", () => {
  it("returns on first success without retrying", async () => {
    const fn = vi.fn(async () => "ok");
    expect(await withRetry(fn, { retries: 3 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries then succeeds", async () => {
    let n = 0;
    const fn = vi.fn(async () => {
      if (n++ < 2) throw new Error("transient");
      return "ok";
    });
    expect(await withRetry(fn, { retries: 3 })).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws the last error after exhausting retries", async () => {
    const fn = vi.fn(async () => {
      throw new Error("always");
    });
    await expect(withRetry(fn, { retries: 2 })).rejects.toThrow("always");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry 4xx by default", async () => {
    const fn = vi.fn(async () => {
      throw new HttpStatusError(404);
    });
    await expect(withRetry(fn, { retries: 3 })).rejects.toThrow("HTTP 404");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("applies exponential backoff via injected sleep", async () => {
    const sleep = vi.fn(async () => undefined);
    let n = 0;
    await withRetry(
      async () => {
        if (n++ < 2) throw new Error("x");
        return "ok";
      },
      { retries: 3, baseDelayMs: 10, sleep },
    );
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });
});

describe("defaultShouldRetry", () => {
  it("retries 5xx and network errors, not 4xx", () => {
    expect(defaultShouldRetry(new HttpStatusError(503))).toBe(true);
    expect(defaultShouldRetry(new HttpStatusError(400))).toBe(false);
    expect(defaultShouldRetry(new Error("network"))).toBe(true);
  });
});

describe("CircuitBreaker", () => {
  it("opens after the failure threshold and rejects fast", async () => {
    const clock = 1000;
    const cb = new CircuitBreaker({ threshold: 2, cooldownMs: 100, now: () => clock });
    const boom = () => Promise.reject(new Error("boom"));

    await expect(cb.exec(boom)).rejects.toThrow("boom");
    await expect(cb.exec(boom)).rejects.toThrow("boom");
    expect(cb.state).toBe("open");
    // fast-fail while open
    await expect(cb.exec(async () => "should not run")).rejects.toThrow("circuit open");
  });

  it("half-opens after cooldown and closes on success", async () => {
    let clock = 1000;
    const cb = new CircuitBreaker({ threshold: 1, cooldownMs: 100, now: () => clock });
    await expect(cb.exec(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(cb.state).toBe("open");
    clock += 150; // past cooldown
    expect(cb.state).toBe("half-open");
    expect(await cb.exec(async () => "ok")).toBe("ok");
    expect(cb.state).toBe("closed");
  });
});
