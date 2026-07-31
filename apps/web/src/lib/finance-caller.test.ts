import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyFinanceRequest: vi.fn(),
}));

vi.mock("@/lib/finance-proxy-handler", () => ({
  proxyFinanceRequest: mocks.proxyFinanceRequest,
}));

import { financeCallerFor } from "./finance-caller";

function incoming(headers: Record<string, string>) {
  return new Request("https://aios.localhost/api/mail-import", { method: "POST", headers });
}

afterEach(() => {
  mocks.proxyFinanceRequest.mockReset();
});

describe("financeCallerFor", () => {
  it("routes through the finance proxy so a finance principal is minted", async () => {
    // Calling apps/api directly with only the shared API key is what returned
    // INTERNAL_PRINCIPAL_REQUIRED for every Hometax invoice.
    mocks.proxyFinanceRequest.mockResolvedValue(Response.json({ status: "created" }));

    const call = financeCallerFor(incoming({ authorization: "Bearer token-1" }));
    await expect(call("tax-invoices/upload-html", { method: "POST", body: '{"html":"<x/>"}' }))
      .resolves.toEqual({ status: "created" });

    const [proxied, method] = mocks.proxyFinanceRequest.mock.calls[0];
    expect(method).toBe("POST");
    expect(proxied.url).toBe("http://sangfor.local/api/finance/tax-invoices/upload-html");
    expect(await proxied.text()).toBe('{"html":"<x/>"}');
  });

  it("forwards a bearer token and a session cookie, since callers use either", async () => {
    mocks.proxyFinanceRequest.mockResolvedValue(Response.json({}));

    const call = financeCallerFor(incoming({
      authorization: "Bearer token-2",
      cookie: "session=cookie-2",
    }));
    await call("dashboard/kpi");

    const [proxied] = mocks.proxyFinanceRequest.mock.calls[0];
    expect(proxied.headers.get("authorization")).toBe("Bearer token-2");
    expect(proxied.headers.get("cookie")).toBe("session=cookie-2");
  });

  it("defaults to GET and sends no body or content-type", async () => {
    mocks.proxyFinanceRequest.mockResolvedValue(Response.json({}));

    const call = financeCallerFor(incoming({ cookie: "session=cookie-3" }));
    await call("dashboard/kpi");

    const [proxied, method] = mocks.proxyFinanceRequest.mock.calls[0];
    expect(method).toBe("GET");
    expect(proxied.headers.get("content-type")).toBeNull();
  });

  it("raises the upstream status without leaking the finance body", async () => {
    mocks.proxyFinanceRequest.mockResolvedValue(
      Response.json({ error: "INTERNAL_PRINCIPAL_REQUIRED", detail: "ledger internals" }, { status: 401 }),
    );

    const call = financeCallerFor(incoming({ authorization: "Bearer token-4" }));
    await expect(call("tax-invoices/upload-html", { method: "POST", body: "{}" }))
      .rejects.toThrow(/finance call failed \(401\)/);
    await expect(call("tax-invoices/upload-html", { method: "POST", body: "{}" }))
      .rejects.not.toThrow(/ledger internals/);
  });
});
