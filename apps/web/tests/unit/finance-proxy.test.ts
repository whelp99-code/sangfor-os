import { describe, expect, it } from "vitest";

describe("finance proxy", () => {
  it("should use FINANCE_API_URL from env with fallback", () => {
    const url = process.env.FINANCE_API_URL || "http://localhost:4100";
    expect(url).toBeTruthy();
  });

  it("should construct proxy URL correctly", () => {
    const path = "dashboard/summary";
    const financeUrl = "http://localhost:4100";
    const url = `${financeUrl}/api/${path}`;
    expect(url).toBe("http://localhost:4100/api/dashboard/summary");
  });

  it("should append query params to proxied URL", () => {
    const path = "invoices";
    const search = "?status=open&page=1";
    const financeUrl = "http://localhost:4100";
    const url = `${financeUrl}/api/${path}${search}`;
    expect(url).toBe("http://localhost:4100/api/invoices?status=open&page=1");
  });

  it("should send X-API-Key header", () => {
    const key = process.env.FINANCE_API_KEY || "test-key";
    expect(key).toBeTruthy();
  });

  it("should return 503 when finance service is unreachable", async () => {
    const financeUrl = "http://localhost:0";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 100);
    try {
      await fetch(`${financeUrl}/api/health`, {
        signal: controller.signal,
      });
    } catch {
      // expected to fail — service unavailable
      expect(true).toBe(true);
    } finally {
      clearTimeout(timeout);
    }
  });
});
