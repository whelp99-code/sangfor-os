import { afterAll, beforeAll, describe, expect, it, beforeEach, vi } from "vitest";

const { mockRag, mockCapability } = vi.hoisted(() => ({ mockRag: vi.fn(), mockCapability: vi.fn() }));
vi.mock("@sangfor/infra", () => ({ engineerConsole: { ragSearch: mockRag } }));
vi.mock("@/lib/auth/authorization", () => ({ assertBusinessCapability: mockCapability }));

import { POST } from "./route";

const prevBypass = process.env.AUTH_BYPASS_ENABLED;
beforeAll(() => {
  process.env.AUTH_BYPASS_ENABLED = "1";
});
afterAll(() => {
  if (prevBypass === undefined) delete process.env.AUTH_BYPASS_ENABLED;
  else process.env.AUTH_BYPASS_ENABLED = prevBypass;
});

function req(body: unknown, raw = false) {
  return new Request("http://localhost/api/engineer/rag", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.AUTH_BYPASS_ENABLED = "1";
  mockRag.mockReset();
  mockCapability.mockReset().mockResolvedValue(null);
});

describe("POST /api/engineer/rag", () => {
  it("rejects a missing query", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect(mockRag).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON", async () => {
    const res = await POST(req("{", true));
    expect(res.status).toBe(400);
    expect(mockRag).not.toHaveBeenCalled();
  });

  it.each([null, [], "query", 1, true])("rejects a non-object body (%j)", async (body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(mockRag).not.toHaveBeenCalled();
  });

  it.each([
    { query: 1 },
    { query: " \n " },
    { query: "x".repeat(8_001) },
    { query: "x", product: false },
    { query: "x", product: " " },
    { query: "x", product: "x".repeat(101) },
    { query: "x", version: 3 },
    { query: "x", version: null },
    { query: "x", version: " " },
    { query: "x", version: "x".repeat(101) },
    { query: "x", limit: "5" },
    { query: "x", limit: null },
    { query: "x", limit: 0 },
    { query: "x", limit: -1 },
    { query: "x", limit: 1.5 },
    { query: "x", limit: 21 },
  ])("rejects malformed present fields (%j)", async (body) => {
    const res = await POST(req(body));
    expect(res.status).toBe(400);
    expect(mockRag).not.toHaveBeenCalled();
  });

  it("returns rag results", async () => {
    mockRag.mockResolvedValue({ query: "ngaf", results: [{ id: "1", text: "policy" }] });
    const res = await POST(req({ query: "ngaf" }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results[0].text).toBe("policy");
    expect(mockRag).toHaveBeenCalledWith(expect.objectContaining({ query: "ngaf" }));
  });

  it("forwards validated product, version and limit while dropping unrelated client fields", async () => {
    const diagnostics = { searchMode: "hash", degraded: true, evidenceRequirement: "live-runtime" };
    mockRag.mockResolvedValue({ results: [], diagnostics });
    const res = await POST(req({ query: " NDR kernel ", product: " NDR ", version: " 3.0.8 ", limit: 20, indexPath: "/private/index.json", actorId: "admin" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [], diagnostics });
    expect(mockRag).toHaveBeenCalledWith({ query: "NDR kernel", product: "NDR", version: "3.0.8", limit: 20 });
    expect(mockCapability).toHaveBeenCalledWith(expect.any(Request), "apps/web/src/app/api/engineer/rag/route.ts");
  });

  it("accepts the exact request bounds", async () => {
    mockRag.mockResolvedValue({ results: [] });
    const res = await POST(req({ query: "x".repeat(8_000), product: "x".repeat(100), version: "x".repeat(100), limit: 1 }));
    expect(res.status).toBe(200);
    expect(mockRag).toHaveBeenCalledTimes(1);
  });

  it("does not invoke retrieval or capability evaluation for unauthenticated requests", async () => {
    process.env.AUTH_BYPASS_ENABLED = "0";
    const res = await POST(req({ query: "NDR" }));
    expect(res.status).toBe(401);
    expect(mockCapability).not.toHaveBeenCalled();
    expect(mockRag).not.toHaveBeenCalled();
  });

  it("does not invoke retrieval when the capability guard denies access", async () => {
    mockCapability.mockResolvedValue(Response.json({ error: "forbidden" }, { status: 403 }));
    const res = await POST(req({ query: "NDR" }));
    expect(res.status).toBe(403);
    expect(mockRag).not.toHaveBeenCalled();
  });

  it("returns 502 with empty results when the console is down", async () => {
    mockRag.mockRejectedValueOnce(new Error("HTTP 503")).mockResolvedValue({ results: [] });
    const res = await POST(req({ query: "x" }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.results).toEqual([]);
    // Error detail is sanitized (Round 7 security); assert the stable error code, not the raw message.
    expect(body.error).toBe("rag_search_failed");
  });
});
