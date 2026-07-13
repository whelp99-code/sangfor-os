import type { AddressInfo } from "node:net";
import { getTokenManager, type BusinessRole } from "@sangfor/auth";
import { callMcpTool } from "@sangfor/infra";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "./index";

vi.mock("@sangfor/infra", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/infra")>();
  return {
    ...actual,
    callMcpTool: vi.fn(async () => ({ result: { ok: true } })),
  };
});

const callMcpToolMock = vi.mocked(callMcpTool);

async function issueBusinessRoleToken(businessRole: BusinessRole): Promise<string> {
  return getTokenManager().issueAccessToken("index-security-test", "sangfor", [], {
    tenantId: "index-security-test-tenant",
    companyId: "index-security-test-company",
    businessRole,
  });
}

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
    vi.stubEnv("NEXTAUTH_SECRET", "index-security-test-secret-32-characters");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3101");
    vi.stubEnv("MICROSOFT_TENANT_ID", "index-security-test-tenant");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "index-security-test-client");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "index-security-test-client-secret");
    vi.stubEnv("GITHUB_TOKEN", "index-security-test-github-token");
    vi.stubEnv("SLACK_BOT_TOKEN", "index-security-test-slack-token");
    const app = createApp();
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
    close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterAll(async () => {
    await close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    callMcpToolMock.mockClear();
  });

  it("rejects an unauthenticated POST /api/whelp99/tools/call with 401", async () => {
    const res = await fetch(`${baseUrl}/api/whelp99/tools/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "sangfor.products" }),
    });
    expect(res.status).toBe(401);
    expect(callMcpToolMock).not.toHaveBeenCalled();
  });

  it("rejects an account manager MCP tool call before invoking the adapter", async () => {
    // Given: a valid bearer token for a non-admin business role.
    const token = await issueBusinessRoleToken("account_manager");

    // When: the account manager requests arbitrary MCP tool execution.
    const res = await fetch(`${baseUrl}/api/whelp99/tools/call`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "sangfor.products" }),
    });

    // Then: authorization fails before the MCP adapter boundary.
    expect(res.status).toBe(403);
    expect(callMcpToolMock).not.toHaveBeenCalled();
  });

  it("allows a system admin MCP tool call to reach the adapter", async () => {
    // Given: a valid bearer token for the system administrator business role.
    const token = await issueBusinessRoleToken("system_admin");

    // When: the system administrator requests arbitrary MCP tool execution.
    const res = await fetch(`${baseUrl}/api/whelp99/tools/call`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "sangfor.products" }),
    });

    // Then: the request reaches the adapter and is not rejected as forbidden.
    expect(res.status).toBe(200);
    expect(callMcpToolMock).toHaveBeenCalledOnce();
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
