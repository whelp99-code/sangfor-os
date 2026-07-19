import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as listMcpToolsRoute, POST as callMcpToolRoute } from "@/app/api/mcp/tools/route";
import { createSessionToken } from "@/lib/auth/session";
import { assertApiAccess, isAuthBypassEnabled } from "./api-auth";

const infraMocks = vi.hoisted(() => ({
  callMcpTool: vi.fn().mockResolvedValue({ ok: true }),
  listMcpTools: vi.fn().mockResolvedValue([]),
}));

vi.mock("@sangfor/infra", () => infraMocks);

type TestSessionRole = "admin" | "operator" | "viewer";

function sessionToken(id: string, role: TestSessionRole): string {
  return createSessionToken({
    id,
    email: `${id}@test.local`,
    role,
    projectId: "project-1",
    projectSlug: "demo-project",
  });
}

function authorizationHeaders(
  id: string,
  role: TestSessionRole,
): { readonly authorization: string } {
  return { authorization: `Bearer ${sessionToken(id, role)}` };
}

function mcpCallRequest(
  name: string,
  args: Readonly<Record<string, unknown>>,
): Request {
  return new Request("http://localhost/api/mcp/tools", {
    method: "POST",
    headers: {
      ...authorizationHeaders("admin-1", "admin"),
      "content-type": "application/json",
    },
    body: JSON.stringify({ name, arguments: args }),
  });
}

const ENV_KEY = "AUTH_BYPASS_ENABLED";

describe("isAuthBypassEnabled", () => {
  it("is true only for an explicit local-development flag", () => {
    // Given
    const environment = { [ENV_KEY]: "1", NODE_ENV: "development" };

    // When / Then
    expect(isAuthBypassEnabled(environment)).toBe(true);
  });

  it("rejects the bypass flag in production", () => {
    // Given
    const environment = { [ENV_KEY]: "1", NODE_ENV: "production" };

    // When / Then
    expect(isAuthBypassEnabled(environment)).toBe(false);
  });

  it("treats absent / empty / other values as off", () => {
    expect(isAuthBypassEnabled({})).toBe(false);
    expect(isAuthBypassEnabled({ [ENV_KEY]: "" })).toBe(false);
    expect(isAuthBypassEnabled({ [ENV_KEY]: " " })).toBe(false);
    expect(isAuthBypassEnabled({ [ENV_KEY]: "0" })).toBe(false);
    expect(isAuthBypassEnabled({ [ENV_KEY]: "true" })).toBe(false);
  });
});

describe("assertApiAccess", () => {
  beforeEach(() => {
    vi.stubEnv(ENV_KEY, "");
    vi.stubEnv("AUTH_PROFILE", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("passes (returns null) when bypass is explicitly enabled", () => {
    vi.stubEnv(ENV_KEY, "1");
    expect(assertApiAccess(new Request("http://localhost/api/tasks"))).toBeNull();
  });

  it("returns a 401 response when the flag is absent", async () => {
    const res = assertApiAccess(new Request("http://localhost/api/tasks"));
    expect(res).not.toBeNull();
    if (!res) throw new TypeError("Expected an unauthorized response");
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Authentication required",
    });
  });

  it("returns a 401 response when the flag is empty", () => {
    vi.stubEnv(ENV_KEY, "");
    const res = assertApiAccess(new Request("http://localhost/api/tasks"));
    expect(res?.status).toBe(401);
  });

  it("rejects a mock session when the explicit local_mock profile is absent", () => {
    vi.stubEnv("JWT_SECRET", "");
    const req = new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { authorization: "Bearer mock.session" },
    });
    expect(assertApiAccess(req)?.status).toBe(401);
  });

  it("accepts the fixed mock session under the explicit local_mock test profile", () => {
    // Given
    vi.stubEnv("JWT_SECRET", "");
    vi.stubEnv("AUTH_PROFILE", "local_mock");
    const request = new Request("http://localhost/api/tasks", {
      method: "POST",
      headers: { authorization: "Bearer mock.session" },
    });

    // When / Then
    expect(assertApiAccess(request)).toBeNull();
  });
});

describe("assertApiAccess with a configured session", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_BYPASS_ENABLED", "");
    vi.stubEnv("JWT_SECRET", "test-secret-at-least-16-chars");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("passes with a valid session cookie (logged-in user must not be 401'd)", async () => {
    const token = sessionToken("u1", "operator");
    const req = new Request("http://localhost/api/tasks", {
      headers: { cookie: `session=${token}` },
    });
    expect(assertApiAccess(req)).toBeNull();
  });

  it("passes with a valid Bearer token", async () => {
    const req = new Request("http://localhost/api/tasks", {
      headers: authorizationHeaders("u1", "operator"),
    });
    expect(assertApiAccess(req)).toBeNull();
  });

  it("allows viewer reads but rejects viewer mutations", async () => {
    const headers = authorizationHeaders("viewer-1", "viewer");

    expect(
      assertApiAccess(new Request("http://localhost/api/customers", { headers })),
    ).toBeNull();

    const denied = assertApiAccess(
      new Request("http://localhost/api/customers", { method: "POST", headers }),
    );
    expect(denied?.status).toBe(403);
    await expect(denied?.json()).resolves.toEqual({ error: "forbidden" });
  });

  it("still 401s a tampered session token", () => {
    const req = new Request("http://localhost/api/tasks", {
      headers: { cookie: "session=forged.token" },
    });
    expect(assertApiAccess(req)?.status).toBe(401);
  });
});

describe("MCP operator boundary", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_BYPASS_ENABLED", "");
    vi.stubEnv("AUTH_PROFILE", "");
    vi.stubEnv("JWT_SECRET", "test-secret-at-least-16-chars");
    vi.stubEnv("NODE_ENV", "test");
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns 401 and does not enumerate tools without credentials", async () => {
    // Given
    const request = new Request("http://localhost/api/mcp/tools");

    // When
    const response = await Reflect.apply(listMcpToolsRoute, undefined, [request]);

    // Then
    expect(response.status).toBe(401);
    expect(infraMocks.listMcpTools).not.toHaveBeenCalled();
  });

  it("returns 403 and does not enumerate tools for a non-system-admin session", async () => {
    // Given
    const request = new Request("http://localhost/api/mcp/tools", {
      headers: authorizationHeaders("operator-1", "operator"),
    });

    // When
    const response = await Reflect.apply(listMcpToolsRoute, undefined, [request]);

    // Then
    expect(response.status).toBe(403);
    expect(infraMocks.listMcpTools).not.toHaveBeenCalled();
  });

  it("returns IDENTITY_CONFLICT before invoking a tool for a spoofed actor", async () => {
    // Given
    const request = mcpCallRequest("sangfor_workflow.apply_approved_operation", {
      approvedBy: "spoofed-admin",
    });

    // When
    const response = await callMcpToolRoute(request);

    // Then
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "IDENTITY_CONFLICT" });
    expect(infraMocks.callMcpTool).not.toHaveBeenCalled();
  });

  it("does not forward the authenticated principal as a domain actor", async () => {
    // Given
    const request = mcpCallRequest("sangfor_workflow.get_workflow_status", {
      workflowId: "workflow-1",
    });

    // When
    const response = await callMcpToolRoute(request);

    // Then
    expect(response.status).toBe(200);
    expect(infraMocks.callMcpTool).toHaveBeenCalledWith(
      "sangfor_workflow.get_workflow_status",
      { workflowId: "workflow-1" },
    );
  });
});

// ── Repo-wide coverage guard ────────────────────────────────────────────────
//
// Phase S (security hardening) DoD: 0 unauthenticated mutation routes. The
// per-route `assertApiAccess` guard is deny-by-default (see above), but that
// only matters if every mutating route.ts actually calls it. This statically
// walks every route.ts under src/app/api and fails if a POST/PUT/PATCH/DELETE
// export is found without a call to assertApiAccess — a durable regression
// net against a future route being added (or edited) without the guard.
const here = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.join(here, "../app/api");

// The login route is the one legitimate exception: it *issues* the session,
// so it cannot itself require one.
const PUBLIC_MUTATING_ROUTES = new Set(["auth/login/route.ts"]);

const MUTATING_EXPORT_RE = /export (?:async function|const)\s+(POST|PUT|PATCH|DELETE)\b/;

function findRouteFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      findRouteFiles(full, acc);
    } else if (entry === "route.ts") {
      acc.push(full);
    }
  }
  return acc;
}

describe("mutating API routes are guarded (static coverage check)", () => {
  it("every route.ts exporting POST/PUT/PATCH/DELETE calls assertApiAccess, except the whitelisted login route", () => {
    const unguarded: string[] = [];
    for (const file of findRouteFiles(API_DIR)) {
      const source = readFileSync(file, "utf8");
      if (!MUTATING_EXPORT_RE.test(source)) continue;
      const rel = path.relative(API_DIR, file).split(path.sep).join("/");
      if (PUBLIC_MUTATING_ROUTES.has(rel)) continue;
      if (
        !source.includes("assertApiAccess") &&
        !source.includes("authorizeOperatorRequest")
      ) {
        unguarded.push(rel);
      }
    }
    expect(unguarded).toEqual([]);
  });
});
