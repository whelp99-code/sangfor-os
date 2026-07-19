import { describe, it, expect, vi } from "vitest";
import { OutlookWebhookHandler } from "./index.js";

describe("OutlookWebhookHandler", () => {
  it("preserves nonempty clientState and async handler", () => {
    const handler = async () => {};
    const h = new OutlookWebhookHandler("secret-state", handler);
    expect(h.clientState).toBe("secret-state");
    expect(h.handler).toBe(handler);
  });

  it("rejects empty clientState", () => {
    expect(() => new OutlookWebhookHandler("", async () => {})).toThrow();
  });

  it("valid two notifications → ordered callbacks exactly once each", async () => {
    const seen: string[] = [];
    const h = new OutlookWebhookHandler("cs", async (mail) => {
      seen.push(String(mail.id));
    });
    await h.handleNotification({
      value: [
        { clientState: "cs", resourceData: { id: "a" } },
        { clientState: "cs", resourceData: { id: "b" } },
      ],
    });
    expect(seen).toEqual(["a", "b"]);
  });

  it("second item invalid clientState → callback 0", async () => {
    const cb = vi.fn(async () => {});
    const h = new OutlookWebhookHandler("cs", cb);
    await h.handleNotification({
      value: [
        { clientState: "cs", resourceData: { id: "a" } },
        { clientState: "wrong", resourceData: { id: "b" } },
      ],
    });
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("malformed resourceData → callback 0", async () => {
    const cb = vi.fn(async () => {});
    const h = new OutlookWebhookHandler("cs", cb);
    await h.handleNotification({
      value: [
        { clientState: "cs", resourceData: { id: "a" } },
        { clientState: "cs", resourceData: null },
      ],
    });
    expect(cb).toHaveBeenCalledTimes(0);
  });

  it("propagates handler rejection", async () => {
    const h = new OutlookWebhookHandler("cs", async () => {
      throw new Error("boom");
    });
    await expect(
      h.handleNotification({
        value: [{ clientState: "cs", resourceData: { id: "a" } }],
      }),
    ).rejects.toThrow("boom");
  });
});
