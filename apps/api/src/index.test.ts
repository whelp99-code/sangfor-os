import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "./index";

/**
 * Phase S / P2 regression net:
 * - POST /api/whelp99/tools/call is arbitrary MCP tool execution and must sit
 *   behind authMiddleware (it was previously registered before the auth
 *   gate, and therefore unauthenticated).
 * - POST /webhooks/outlook must stay public (Azure/Graph calls it, not a
 *   logged-in user) but must reject notifications whose `clientState` does
 *   not match WEBHOOK_CLIENT_STATE.
 *
 * No supertest dependency here (not installed in apps/api) — spin up the
 * real app on an ephemeral port and use the platform fetch, mirroring how
 * the app actually runs.
 */
describe("apps/api security ordering (index.ts)", () => {
  let baseUrl: string;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const app = createApp();
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterAll(async () => {
    await close();
  });

  it("rejects an unauthenticated POST /api/whelp99/tools/call with 401", async () => {
    const res = await fetch(`${baseUrl}/api/whelp99/tools/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "sangfor.products" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an outlook webhook notification with a missing clientState", async () => {
    const res = await fetch(`${baseUrl}/webhooks/outlook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: [{ subscriptionId: "sub-1" }] }),
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "invalid_client_state" });
  });

  it("rejects an outlook webhook notification with a mismatched clientState", async () => {
    const res = await fetch(`${baseUrl}/webhooks/outlook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: [{ clientState: "not-the-right-secret" }] }),
    });
    expect(res.status).toBe(401);
  });

  it("accepts an outlook webhook notification whose clientState matches WEBHOOK_CLIENT_STATE", async () => {
    const expected = process.env.WEBHOOK_CLIENT_STATE || "aios-webhook";
    const res = await fetch(`${baseUrl}/webhooks/outlook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: [{ clientState: expected }] }),
    });
    expect(res.status).toBe(202);
  });

  it("still serves GET /webhooks/outlook validation handshake publicly", async () => {
    const res = await fetch(`${baseUrl}/webhooks/outlook?validationToken=abc123`);
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("abc123");
  });
});
