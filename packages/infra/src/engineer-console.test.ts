import { describe, expect, it, vi } from "vitest";

import { engineerConsole } from "./engineer-console";

function jsonResponse(body: unknown, init: { ok: boolean; status: number } = { ok: true, status: 200 }): Response {
  return { ok: init.ok, status: init.status, json: () => Promise.resolve(body) } as unknown as Response;
}

describe("engineerConsole", () => {
  it("POSTs rag-search and returns typed results", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ query: "ngaf", results: [{ id: "1", text: "policy", score: 0.9 }] }),
    );
    const out = await engineerConsole.ragSearch(
      { query: "ngaf" },
      { baseUrl: "http://c", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(out.results?.[0].text).toBe("policy");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("http://c/api/rag-search");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ query: "ngaf" });
  });

  it("GETs products", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ products: [{ id: "ngaf", name: "NGAF" }] }));
    const out = await engineerConsole.products({ baseUrl: "http://c", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(out.products?.[0].name).toBe("NGAF");
    expect(fetchImpl.mock.calls[0][0]).toBe("http://c/api/products");
    expect(fetchImpl.mock.calls[0][1].method).toBe("GET");
  });

  it("normalizes legacy arrays and forwards the requested version", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([{ id: "1", text: "policy", filePath: "/manual.md" }]));
    const out = await engineerConsole.ragSearch(
      { query: "policy", product: "NDR", version: "3.0.8", limit: 5 },
      { baseUrl: "http://c", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(out.results[0].source).toBe("/manual.md");
    expect(out.results[0].textSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out.diagnostics).toBeUndefined();
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ query: "policy", product: "NDR", version: "3.0.8", limit: 5 });
  });

  it("fails malformed successful responses without hiding them as empty results or retrying", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ results: null }));
    await expect(engineerConsole.ragSearch({ query: "policy" }, { baseUrl: "http://c", fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow("Invalid engineer RAG response: results");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("GETs knowledge with encoded query params", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ product: "HCI", type: "manual", items: [] }));
    await engineerConsole.knowledge("HCI", "manual", {
      baseUrl: "http://c",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl.mock.calls[0][0]).toBe("http://c/api/knowledge?product=HCI&type=manual");
  });

  it("throws on non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 503 }));
    await expect(
      engineerConsole.products({ baseUrl: "http://c", fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow("HTTP 503");
  });
});
