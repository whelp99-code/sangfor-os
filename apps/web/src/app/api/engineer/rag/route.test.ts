import { afterAll, beforeAll, describe, expect, it, beforeEach, vi } from "vitest";

const { mockRag } = vi.hoisted(() => ({ mockRag: vi.fn() }));
vi.mock("@sangfor/infra", () => ({ engineerConsole: { ragSearch: mockRag } }));

import { POST } from "./route";

const prevBypass = process.env.AUTH_BYPASS_ENABLED;
beforeAll(() => {
  process.env.AUTH_BYPASS_ENABLED = "1";
});
afterAll(() => {
  process.env.AUTH_BYPASS_ENABLED = prevBypass;
});

function req(body: unknown, raw = false) {
  return new Request("http://localhost/api/engineer/rag", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => mockRag.mockReset());

describe("POST /api/engineer/rag", () => {
  it("rejects a missing query", async () => {
    const res = await POST(req({}));
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
