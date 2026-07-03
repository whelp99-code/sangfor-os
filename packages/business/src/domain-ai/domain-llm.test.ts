import { describe, it, expect, vi } from "vitest";
import {
  defaultOpenAiModel,
  resolveDomainModel,
  createOpencodeDomainGenerator,
} from "./domain-llm";

function mockFetch(handler: (url: string, init: RequestInit) => unknown) {
  return vi.fn(async (url: string, init: RequestInit) => ({
    ok: true,
    status: 200,
    statusText: "",
    json: async () => handler(url, init),
  })) as unknown as typeof fetch;
}

describe("resolveDomainModel", () => {
  it("uses the env/default model when no override", () => {
    expect(resolveDomainModel("cfo").providerID).toBe(defaultOpenAiModel().providerID);
  });

  it("prefers a per-domain override (도메인별 라우팅)", () => {
    const models = { cfo: { providerID: "openai", modelID: "gpt-5-strong" } };
    expect(resolveDomainModel("cfo", models)).toEqual({ providerID: "openai", modelID: "gpt-5-strong" });
    // 다른 도메인은 기본으로 폴백
    expect(resolveDomainModel("marketing", models)).toEqual(defaultOpenAiModel());
  });
});

describe("createOpencodeDomainGenerator", () => {
  it("creates a session, prompts with the routed model, returns a domain artifact", async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchImpl = mockFetch((url, init) => {
      const body = init.body ? JSON.parse(init.body as string) : null;
      calls.push({ url: url as string, body });
      if ((url as string).endsWith("/session")) return { id: "sess_42" };
      return { info: {}, parts: [{ type: "text", text: "엔지니어 산출물 텍스트" }] };
    });

    const gen = createOpencodeDomainGenerator({
      fetchImpl,
      models: { engineer: { providerID: "openai", modelID: "gpt-5-strong" } },
    });

    const artifact = await gen({
      domain: "engineer",
      case: { id: "c1", subject: "현장 구축", tags: ["onsite"] },
      recalled: [],
      prompt: "PROMPT_BODY",
    });

    expect(artifact.produces).toBe("asset-handoff"); // engineer 도메인 산출물
    expect(artifact.summary).toBe("엔지니어 산출물 텍스트");
    expect((artifact.payload as any).model).toEqual({ providerID: "openai", modelID: "gpt-5-strong" });

    const promptCall = calls.find((c) => c.url.includes("/message"));
    expect(promptCall!.body.model).toEqual({ providerID: "openai", modelID: "gpt-5-strong" });
    expect(promptCall!.body.parts).toEqual([{ type: "text", text: "PROMPT_BODY" }]);
  });
});
