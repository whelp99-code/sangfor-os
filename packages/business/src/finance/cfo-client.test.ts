import { afterEach, describe, expect, it, vi } from "vitest";

import { cfoFetch } from "./cfo-client";

describe("cfoFetch error boundary", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not expose the upstream response body to callers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response('{"secret":"database detail"}', { status: 500 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(cfoFetch("dashboard/kpi")).rejects.toThrow(
      "재무 데이터를 불러오지 못했습니다. (500)",
    );
    await expect(cfoFetch("dashboard/kpi")).rejects.not.toThrow("database detail");
  });
});
