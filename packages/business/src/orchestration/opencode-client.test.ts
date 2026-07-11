import { describe, it, expect, vi } from "vitest";
import {
  resolveOpencodeBaseUrl,
  buildOpencodeHeaders,
  extractAssistantText,
  createOpencodeSession,
  opencodePrompt,
  opencodeHealth,
} from "./opencode-client";

function mockFetch(handler: (url: string, init: RequestInit) => { ok?: boolean; status?: number; json?: unknown }) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const r = handler(url, init);
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      statusText: "",
      json: async () => r.json ?? {},
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

describe("config helpers", () => {
  it("defaults base url and strips trailing slash", () => {
    expect(resolveOpencodeBaseUrl()).toBe("http://127.0.0.1:4096");
    expect(resolveOpencodeBaseUrl({ baseUrl: "http://x:1/" })).toBe("http://x:1");
  });

  it("adds basic-auth header only when password set", () => {
    expect(buildOpencodeHeaders({}).authorization).toBeUndefined();
    const h = buildOpencodeHeaders({ password: "secret", user: "u" });
    expect(h.authorization).toBe("Basic " + Buffer.from("u:secret").toString("base64"));
  });
});

describe("extractAssistantText", () => {
  it("concatenates text parts and ignores non-text", () => {
    const parts = [
      { type: "text", text: "Hello " },
      { type: "tool", text: "ignored" },
      { type: "text", text: "world" },
      { type: "text" },
    ];
    expect(extractAssistantText(parts)).toBe("Hello world");
  });
});

describe("createOpencodeSession", () => {
  it("POSTs /session and returns id", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetchImpl = mockFetch((url, init) => {
      seen = { url, init };
      return { json: { id: "sess_1" } };
    });
    const out = await createOpencodeSession({ fetchImpl, title: "t" });
    expect(out.id).toBe("sess_1");
    expect(seen!.url).toBe("http://127.0.0.1:4096/session");
    expect(seen!.init.method).toBe("POST");
  });

  it("throws on non-ok", async () => {
    const fetchImpl = mockFetch(() => ({ ok: false, status: 500 }));
    await expect(createOpencodeSession({ fetchImpl })).rejects.toThrow(/session create failed: 500/);
  });
});

describe("opencodePrompt", () => {
  it("sends model object + text part and extracts assistant text", async () => {
    let body: any = null;
    const fetchImpl = mockFetch((_url, init) => {
      body = JSON.parse(init.body as string);
      return { json: { info: {}, parts: [{ type: "text", text: "answer" }] } };
    });
    const text = await opencodePrompt({
      fetchImpl,
      sessionID: "s1",
      model: { providerID: "openai", modelID: "gpt-5" },
      prompt: "hi",
      system: "be terse",
    });
    expect(text).toBe("answer");
    expect(body.model).toEqual({ providerID: "openai", modelID: "gpt-5" });
    expect(body.parts).toEqual([{ type: "text", text: "hi" }]);
    expect(body.system).toBe("be terse");
  });
});

describe("opencodeHealth", () => {
  it("returns true when ok, false on throw", async () => {
    expect(await opencodeHealth({ fetchImpl: mockFetch(() => ({ ok: true })) })).toBe(true);
    const boom = vi.fn(async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(await opencodeHealth({ fetchImpl: boom })).toBe(false);
  });
});
