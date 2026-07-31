import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sangfor/db", () => ({
  prisma: {
    mailAccount: { findFirst: vi.fn(), create: vi.fn() },
    mailMessage: { findFirst: vi.fn(), create: vi.fn() },
    project: { findFirst: vi.fn() },
  },
}));

import { OutlookSyncService } from "./outlook-sync";

const TOKEN_HOST = "login.microsoftonline.com";
const GRAPH_MESSAGES = "graph.microsoft.com/v1.0/me/messages";

/** Answers the token call, then hands the messages call to `onMessages`. */
function stubGraph(onMessages: () => Response) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes(TOKEN_HOST)) {
      // No expires_in: the service only arms its refresh timer when one is
      // present, and a stray timer would outlive the test.
      return new Response(JSON.stringify({ access_token: "app-only-token" }), { status: 200 });
    }
    if (url.includes(GRAPH_MESSAGES)) return onMessages();
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("OutlookSyncService.fetchMessages", () => {
  beforeEach(() => {
    vi.stubEnv("OUTLOOK_CLIENT_ID", "client-id");
    vi.stubEnv("OUTLOOK_CLIENT_SECRET", "client-secret");
    vi.stubEnv("OUTLOOK_TENANT_ID", "tenant-id");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("raises the Graph rejection instead of reporting an empty mailbox", async () => {
    // Graph answers exactly this when `/me` is called with an app-only token.
    // The body still parses as JSON, so reading `value` off it used to yield
    // [] and a sync of zero mail was indistinguishable from a healthy run
    // against an empty inbox.
    stubGraph(() => new Response(
      JSON.stringify({
        error: { code: "BadRequest", message: "/me request is only valid with delegated authentication flow." },
      }),
      { status: 400 },
    ));

    await expect(new OutlookSyncService().fetchMessages()).rejects.toThrow(/Graph 400/);
  });

  it("returns the messages Graph delivers on success", async () => {
    stubGraph(() => new Response(
      JSON.stringify({ value: [{ id: "1", subject: "Quote request" }] }),
      { status: 200 },
    ));

    await expect(new OutlookSyncService().fetchMessages()).resolves.toEqual([
      { id: "1", subject: "Quote request" },
    ]);
  });

  it("reports no messages when the tenant refuses to issue a token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 })));

    await expect(new OutlookSyncService().fetchMessages()).resolves.toEqual([]);
  });
});
