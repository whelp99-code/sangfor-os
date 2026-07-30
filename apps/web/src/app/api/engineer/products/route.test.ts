import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockProducts } = vi.hoisted(() => ({ mockProducts: vi.fn() }));
vi.mock("@sangfor/infra", () => ({ engineerConsole: { products: mockProducts } }));

import { GET } from "./route";

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  mockProducts.mockReset();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

/** What fetch actually throws when the upstream is not listening. */
function fetchFailed() {
  const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3502"), { code: "ECONNREFUSED" });
  const aggregate = Object.assign(new AggregateError([inner], ""), { code: "ECONNREFUSED" });
  return Object.assign(new TypeError("fetch failed"), { cause: aggregate });
}

describe("GET /api/engineer/products", () => {
  it("returns the catalog when the console answers", async () => {
    mockProducts.mockResolvedValue({ products: [{ id: "ngaf", name: "NGAF" }] });
    const body = await (await GET()).json();
    expect(body.products[0].id).toBe("ngaf");
    expect(body.degraded).toBeUndefined();
  });

  it("degrades to an empty catalog when the console is unreachable", async () => {
    mockProducts.mockRejectedValue(fetchFailed());
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ products: [], error: "products_unavailable", degraded: true });
  });

  it("logs one line for an unreachable console, without the stack", async () => {
    mockProducts.mockRejectedValue(fetchFailed());
    await GET();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("[api] products_unavailable: engineer console unreachable");
    // The error object itself must not be handed to the logger for this case.
    expect(warn.mock.calls[0]).toHaveLength(1);
  });

  it("still logs the full error for anything that is not a connection failure", async () => {
    const boom = new Error("malformed catalog payload");
    mockProducts.mockRejectedValue(boom);
    await GET();
    expect(warn).toHaveBeenCalledWith("[api] products_unavailable:", boom);
  });
});
