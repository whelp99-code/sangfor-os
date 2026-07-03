import { describe, it, expect, vi } from "vitest";
import { createOpenAiEmbedder, resolveEmbedder, describeEmbedder } from "./domain-embedder-openai";
import { createDefaultDomainGenerator } from "./domain-default-generator";

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  return vi.fn(async (url: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: "",
    json: async () => handler(url, init),
  })) as unknown as typeof fetch;
}

describe("real embedding provider", () => {
  it("createOpenAiEmbedder posts to /embeddings and returns the vector", async () => {
    let body: any = null;
    const fetchImpl = mockFetch((_u, init) => {
      body = JSON.parse(init.body as string);
      return { data: [{ embedding: [0.1, 0.2, 0.3] }] };
    });
    const embed = createOpenAiEmbedder({ apiKey: "k", baseUrl: "http://x/v1", model: "m", fetchImpl });
    expect(await embed("hello")).toEqual([0.1, 0.2, 0.3]);
    expect(body.model).toBe("m");
    expect(body.input).toBe("hello");
  });

  it("resolveEmbedder falls back to hash when no key (offline-usable)", async () => {
    const embed = resolveEmbedder({ apiKey: "", dim: 32 });
    const v = await embed("offline text");
    expect(v.length).toBe(32); // hash embedder dimension → no network needed
    expect(describeEmbedder({ apiKey: "" })).toBe("hash");
    expect(describeEmbedder({ apiKey: "sk-x" })).toBe("openai");
  });
});

describe("default domain generator (structured→text→stub)", () => {
  it("falls straight to stub when the server is unhealthy", async () => {
    const gen = createDefaultDomainGenerator({
      fetchImpl: mockFetch(() => ({})), // health uses this too
      // force health false via a base url that the mock treats as down:
    });
    // override health by pointing at an injected fetch that fails health:
    const genDown = createDefaultDomainGenerator({
      fetchImpl: vi.fn(async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
    });
    const out = await genDown({
      domain: "sales",
      case: { id: "c", subject: "s", tags: [] },
      recalled: [],
      prompt: "p",
    });
    // stub uses the domain definition's produces
    expect(out.produces).toBe("opportunity-with-quote");
    expect(gen).toBeTypeOf("function");
  });
});
