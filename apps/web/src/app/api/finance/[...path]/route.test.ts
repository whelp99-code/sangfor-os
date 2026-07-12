import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET } from "./route";

const prevBypass = process.env.AUTH_BYPASS_ENABLED;
beforeAll(() => {
  process.env.AUTH_BYPASS_ENABLED = "1";
});
afterAll(() => {
  process.env.AUTH_BYPASS_ENABLED = prevBypass;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function financeReq(path = "/api/finance/invoices"): NextRequest {
  return new NextRequest(`http://localhost:3101${path}`);
}

describe("GET /api/finance/[...path]", () => {
  it("returns 502 when upstream returns non-JSON body (e.g. HTML)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '<html>\n<body>\n<h1>Gateway Timeout</h1>\n</body>\n</html>',
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(financeReq());

    expect(res.status).toBe(502);
    // Round 7 security: raw upstream text must never leak to the client.
    const raw = await res.text();
    expect(raw).not.toContain("Gateway Timeout");
    expect(raw).not.toContain("<html>");

    const body = JSON.parse(raw);
    expect(body).toEqual({ error: "upstream_unavailable" });
  });

  it("passes through a valid JSON response unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ invoices: [{ id: "INV-001", amount: 1500 }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(financeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ invoices: [{ id: "INV-001", amount: 1500 }] });
  });

  it("passes through a non-200 JSON response with upstream status intact", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 404,
      text: async () => JSON.stringify({ error: "not_found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(financeReq());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "not_found" });
  });

  it("returns 502 when the upstream is unreachable (fetch throws)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(financeReq());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body).toEqual({ error: "upstream_unavailable" });
  });
});
