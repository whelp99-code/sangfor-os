import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForToken: vi.fn(),
  connectOutlookAccount: vi.fn(),
}));

vi.mock("@/lib/outlook", () => ({
  exchangeCodeForToken: mocks.exchangeCodeForToken,
  connectOutlookAccount: mocks.connectOutlookAccount,
}));

import { NextRequest } from "next/server";

import { GET } from "./route";

// Microsoft calls this endpoint through Caddy, but the container listens on
// HOSTNAME=0.0.0.0, so `request.url` carries that internal origin.
const INTERNAL_URL = "http://0.0.0.0:3101/api/mail/oauth/callback";
const PUBLIC_ORIGIN = "https://aios.localhost";

function callback(query: string, cookie?: string) {
  return new NextRequest(`${INTERNAL_URL}${query}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("GET /api/mail/oauth/callback", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", PUBLIC_ORIGIN);
    mocks.exchangeCodeForToken.mockReset();
    mocks.connectOutlookAccount.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends the browser back to the public origin after a successful exchange", async () => {
    mocks.exchangeCodeForToken.mockResolvedValue({ access_token: "at" });
    mocks.connectOutlookAccount.mockResolvedValue({ email: "operator@example.com" });

    const response = await GET(callback("?code=abc&state=s1", "outlook_oauth_state=s1"));
    const location = new URL(response.headers.get("location") ?? "");

    // Redirecting to the internal origin stranded the user on an unreachable
    // address even though the mailbox had already been connected.
    expect(location.origin).toBe(PUBLIC_ORIGIN);
    expect(location.pathname).toBe("/settings/mail-connection");
    expect(location.searchParams.get("connected")).toBe("operator@example.com");
  });

  it("keeps the public origin when the state cookie does not match", async () => {
    const response = await GET(callback("?code=abc&state=s1", "outlook_oauth_state=other"));
    const location = new URL(response.headers.get("location") ?? "");

    expect(location.origin).toBe(PUBLIC_ORIGIN);
    expect(location.searchParams.get("error")).toBe("invalid_state");
    expect(mocks.exchangeCodeForToken).not.toHaveBeenCalled();
  });

  it("falls back to the request origin when no public origin is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    mocks.exchangeCodeForToken.mockResolvedValue({ access_token: "at" });
    mocks.connectOutlookAccount.mockResolvedValue({ email: "operator@example.com" });

    const response = await GET(callback("?code=abc&state=s1", "outlook_oauth_state=s1"));

    expect(new URL(response.headers.get("location") ?? "").origin).toBe("http://0.0.0.0:3101");
  });
});
