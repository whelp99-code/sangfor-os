import { afterAll, beforeAll, describe, expect, it, beforeEach, vi } from "vitest";

const { mockList, mockCall } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockCall: vi.fn(),
}));
vi.mock("@sangfor/infra", () => ({
  listMcpTools: mockList,
  callMcpTool: mockCall,
}));

import { GET, POST } from "./route";

const prevBypass = process.env.AUTH_BYPASS_ENABLED;
beforeAll(() => {
  process.env.AUTH_BYPASS_ENABLED = "1";
});
afterAll(() => {
  process.env.AUTH_BYPASS_ENABLED = prevBypass;
});

function postReq(body: unknown, raw = false) {
  return new Request("http://localhost/api/mcp/tools", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

beforeEach(() => {
  mockList.mockReset();
  mockCall.mockReset();
});

describe("GET /api/mcp/tools", () => {
  it("returns the tools list", async () => {
    mockList.mockResolvedValue([{ name: "sangfor.products" }]);
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.tools).toEqual([{ name: "sangfor.products" }]);
  });

  it("returns 502 with empty tools when the bridge is unreachable", async () => {
    mockList.mockRejectedValue(new Error("fetch failed"));
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.tools).toEqual([]);
    // Error detail is sanitized (Round 7 security); assert the stable error code, not the raw message.
    expect(body.error).toBe("mcp_tools_unreachable");
  });
});

describe("POST /api/mcp/tools", () => {
  it("rejects a missing tool name with 400", async () => {
    const res = await POST(postReq({ arguments: {} }));
    expect(res.status).toBe(400);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await POST(postReq("{not json", true));
    expect(res.status).toBe(400);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it("forwards name + arguments and returns the result", async () => {
    mockCall.mockResolvedValue({ result: { ok: true } });
    const res = await POST(postReq({ name: "sangfor.products", arguments: { product: "HCI" } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ result: { ok: true } });
    expect(mockCall).toHaveBeenCalledWith("sangfor.products", { product: "HCI" });
  });

  it("returns 502 when the bridge rejects (e.g. whitelist)", async () => {
    mockCall.mockResolvedValue({ error: "Tool not in safe whitelist", allowedTools: ["sangfor.products"] });
    const res = await POST(postReq({ name: "danger" }));
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toContain("whitelist");
    expect(mockCall).toHaveBeenCalledWith("danger", {});
  });
});
