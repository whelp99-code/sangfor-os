import { describe, expect, it, vi } from "vitest";

import { notifyTransitions } from "./alerts";

describe("notifyTransitions", () => {
  it("is a no-op with no transitions", async () => {
    const fetchImpl = vi.fn();
    const res = await notifyTransitions([], { webhookUrl: "https://hook", fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res).toEqual({ sent: false, count: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is a no-op when no webhook is configured", async () => {
    const fetchImpl = vi.fn();
    const res = await notifyTransitions([{ id: "a", from: "healthy", to: "unreachable" }], {
      webhookUrl: "",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.sent).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("posts a Slack message when webhook + transitions are present", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const res = await notifyTransitions(
      [
        { id: "mcp", from: "healthy", to: "unreachable" },
        { id: "wf", from: "unreachable", to: "healthy" },
      ],
      { webhookUrl: "https://hooks.slack/x", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(res).toEqual({ sent: true, count: 2 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://hooks.slack/x");
    const body = JSON.parse(init.body);
    expect(body.text).toContain("mcp");
    expect(body.text).toContain("복구");
  });

  it("reports not-sent when the webhook call throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network"));
    const res = await notifyTransitions([{ id: "a", from: "healthy", to: "unreachable" }], {
      webhookUrl: "https://hook",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.sent).toBe(false);
  });
});
