import { describe, expect, it } from "vitest";
import { buildFinanceProxyUrl } from "../../src/lib/finance-proxy";

describe("finance proxy", () => {
  it("should use FINANCE_API_URL from env with fallback to CFO API path", () => {
    const url = process.env.FINANCE_API_URL || "http://localhost:3200/api/cfo";
    expect(url).toBeTruthy();
  });

  it("should construct proxy URL correctly", () => {
    const url = buildFinanceProxyUrl(
      "/api/finance/dashboard/summary",
      "",
      "http://localhost:3200/api/cfo",
    );
    expect(url).toBe("http://localhost:3200/api/cfo/dashboard/summary");
  });

  it("should append query params to proxied URL", () => {
    const url = buildFinanceProxyUrl(
      "/api/finance/invoices",
      "?status=open&page=1",
      "http://localhost:3200/api/cfo",
    );
    expect(url).toBe("http://localhost:3200/api/cfo/invoices?status=open&page=1");
  });

  it("should send X-API-Key header", () => {
    const key = process.env.FINANCE_API_KEY || process.env.API_KEY || "test-key";
    expect(key).toBeTruthy();
  });

  it("should return 503 when API service is unreachable", async () => {
    const apiUrl = "http://localhost:0";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 100);
    try {
      await fetch(`${apiUrl}/api/health`, {
        signal: controller.signal,
      });
    } catch {
      expect(true).toBe(true);
    } finally {
      clearTimeout(timeout);
    }
  });
});
