import { describe, it, expect, vi } from "vitest";
import { createOpenAiEmbedder, resolveEmbedder, describeEmbedder } from "./domain-embedder-openai";
import { safeEmbed } from "./domain-embedding";
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

  it("aborts a hanging embedding call at the deadline and degrades to no embedding", async () => {
    const hanging = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted by deadline")));
        }),
    ) as unknown as typeof fetch;
    const embed = createOpenAiEmbedder({
      apiKey: "k",
      baseUrl: "http://x/v1",
      fetchImpl: hanging,
      timeoutMs: 20,
    });

    await expect(embed("hello")).rejects.toThrow();
    // 멈춘 엔드포인트는 호출 경로를 붙잡지 않고 태그 전용 저하로 끝난다
    expect(await safeEmbed(embed, "hello")).toBeNull();
  });

  it("resolveEmbedder falls back to hash when no key and no embedding endpoint (offline-usable)", async () => {
    vi.stubEnv("EMBEDDING_BASE_URL", "");
    try {
      const embed = resolveEmbedder({ apiKey: "", dim: 32 });
      const v = await embed("offline text");
      expect(v.length).toBe(32); // hash embedder dimension → no network needed
      expect(describeEmbedder({ apiKey: "" })).toBe("hash");
      expect(describeEmbedder({ apiKey: "sk-x" })).toBe("openai");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("prefers an explicit embedding endpoint over the OpenAI key", () => {
    expect(describeEmbedder({ baseUrl: "http://embed.local/v1", apiKey: "sk-x" })).toBe("embedding-endpoint");
    expect(describeEmbedder({ baseUrl: "http://embed.local/v1", apiKey: "" })).toBe("embedding-endpoint");
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
