import { createServer } from "node:http";

import express, { type Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { getTokenManager } from "@sangfor/auth";

const routeSpies = vi.hoisted(() => ({
  probeIntegrationTarget: vi.fn(async () => ({
    id: "whelp99-code-sangfor-engineer-mcp",
    status: "healthy",
    upstream: "http://127.0.0.1:3600",
    latencyMs: 1,
  })),
  probeAllIntegrationTargets: vi.fn(async () => []),
}));

vi.mock("@sangfor/infra", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/infra")>();
  return { ...actual, ...routeSpies };
});

type HttpResult = {
  readonly status: number;
  readonly body: string;
};

const authenticatedBodySchema = z.object({
  principalId: z.string(),
  businessRole: z.string(),
});

async function requestApp(app: Express): Promise<HttpResult> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Expected an ephemeral TCP listener");
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/probe`);
    return { status: response.status, body: await response.text() };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function requestRoute(
  app: Express,
  method: "GET" | "POST",
  path: string,
  bearerToken?: string,
): Promise<number> {
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("Expected an ephemeral TCP listener");
  }

  try {
    const headers: Record<string, string> = {};
    if (method === "POST") headers["content-type"] = "application/json";
    if (bearerToken) headers.authorization = `Bearer ${bearerToken}`;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers,
      body: method === "POST" ? "{}" : undefined,
    });
    const status = response.status;
    await response.body?.cancel();
    return status;
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

const PROTECTED_ROUTE_MATRIX = [
  ["GET", "/api/metrics"],
  ["GET", "/health"],
  ["GET", "/api/health"],
  ["GET", "/api/whelp99/health"],
  ["GET", "/api/integrations/health"],
  ["GET", "/api/slack/status"],
  ["GET", "/api/events/stream"],
  ["POST", "/api/events/emit"],
  ["GET", "/api/cfo/health"],
  ["GET", "/api/cfo/health/ready"],
] as const;

describe("authMiddleware containment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(PROTECTED_ROUTE_MATRIX)("denies unauthenticated %s %s on the real API route matrix", async (method, path) => {
    // Given: strict request authentication and the production route composition.
    vi.stubEnv("AUTH_BYPASS_ENABLED", "0");
    vi.stubEnv("AUTH_PROFILE", "strict");
    const { createApp } = await import("../index");

    // When: an unauthenticated caller reaches a diagnostic or metadata route.
    const status = await requestRoute(createApp(), method, path);

    // Then: routing denies before returning or probing internal detail.
    expect(status).toBe(401);
    expect(routeSpies.probeIntegrationTarget).not.toHaveBeenCalled();
    expect(routeSpies.probeAllIntegrationTargets).not.toHaveBeenCalled();
  });

  it.each(PROTECTED_ROUTE_MATRIX)("denies non-operator %s %s on the real API route matrix", async (method, path) => {
    vi.stubEnv("DATABASE_URL", "postgresql://u002:u002@127.0.0.1:5434/u002");
    vi.stubEnv("NEXTAUTH_SECRET", "u002-route-matrix-secret-at-least-32-characters");
    vi.stubEnv("NEXTAUTH_URL", "http://127.0.0.1:3101");
    vi.stubEnv("MICROSOFT_TENANT_ID", "u002-tenant");
    vi.stubEnv("MICROSOFT_CLIENT_ID", "u002-client");
    vi.stubEnv("MICROSOFT_CLIENT_SECRET", "u002-client-secret");
    vi.stubEnv("GITHUB_TOKEN", "u002-github-token");
    vi.stubEnv("SLACK_BOT_TOKEN", "u002-slack-token");
    vi.stubEnv("AUTH_BYPASS_ENABLED", "0");
    vi.stubEnv("AUTH_PROFILE", "strict");
    const token = await getTokenManager().issueAccessToken("u002-account-manager", "sangfor", [], {
      tenantId: "u002-tenant",
      companyId: "u002-company",
      businessRole: "account_manager",
    });
    const { createApp } = await import("../index");

    const status = await requestRoute(createApp(), method, path, token);

    expect(status).toBe(path.startsWith("/api/cfo/") ? 401 : 403);
    expect(routeSpies.probeIntegrationTarget).not.toHaveBeenCalled();
    expect(routeSpies.probeAllIntegrationTargets).not.toHaveBeenCalled();
  });

  it("returns 401 when development bypass lacks the explicit local_mock profile", async () => {
    // Given: development enables the legacy bypass flag without the required profile.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_BYPASS_ENABLED", "1");
    vi.stubEnv("AUTH_PROFILE", "");
    const { authMiddleware } = await import("./auth");
    const app = express();
    app.use(authMiddleware);
    app.get("/probe", (_request, response) => response.json({ ok: true }));

    // When: an unauthenticated request reaches the middleware.
    const result = await requestApp(app);

    // Then: no fixture identity is granted.
    expect(result.status).toBe(401);
  });

  it("derives the fixture principal server-side only for explicit local_mock development", async () => {
    // Given: the explicit local-only mock profile is enabled in development.
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("AUTH_BYPASS_ENABLED", "1");
    vi.stubEnv("AUTH_PROFILE", "local_mock");
    const { authMiddleware } = await import("./auth");
    const app = express();
    app.use(authMiddleware);
    app.get("/probe", (request, response) => {
      response.json({
        principalId: request.authContext?.userId,
        businessRole: request.authContext?.businessRole,
      });
    });

    // When: an unauthenticated request reaches the middleware.
    const result = await requestApp(app);

    // Then: the only granted identity is the server fixture.
    expect(result.status).toBe(200);
    expect(authenticatedBodySchema.parse(JSON.parse(result.body))).toEqual({
      principalId: "dev-user",
      businessRole: "system_admin",
    });
  });
});
