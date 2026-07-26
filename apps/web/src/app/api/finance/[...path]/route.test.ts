import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { createSessionToken, type SessionUser } from "@/lib/auth/session";

const dbMocks = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  authSessionFindFirst: vi.fn(),
  userCompanyRoleFindMany: vi.fn(),
}));
vi.mock("@sangfor/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@sangfor/db")>();
  return { ...actual, prisma: { ...actual.prisma,
    project: { findUnique: dbMocks.projectFindUnique },
    authSession: { findFirst: dbMocks.authSessionFindFirst },
    userCompanyRole: { findMany: dbMocks.userCompanyRoleFindMany },
  } };
});

import { GET, POST } from "./route";

const prevBypass = process.env.AUTH_BYPASS_ENABLED;
const prevJwtSecret = process.env.JWT_SECRET;
const prevFinanceApiKey = process.env.FINANCE_API_KEY;
const ADMIN_USER: SessionUser = {
  id: "finance-route-admin",
  email: "finance-route-admin@example.com",
  role: "operator",
  projectId: "finance-route-project",
  projectSlug: "finance-route-project",
};
const IDENTITY_FIELDS = [
  "approvedBy", "actorId", "requestedBy", "requester", "approver", "approverId", "approverPersonaId", "personaId",
] as const;
const CONFLICT_CASES = IDENTITY_FIELDS.flatMap((field) => [
  [`${field} root`, { [field]: "caller-spoof" }],
  [`${field} nested`, { nested: { [field]: "caller-spoof" } }],
  [`${field} array`, { nested: [{ [field]: "caller-spoof" }] }],
] as const);
const protocolEnv = () => {
  const timestamp = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const keyring = (kid: string, byte: number) => JSON.stringify({ version: "sangfor.internal-principal-keyring/v1", keys: [{ kid, state: "active", secretBase64Url: Buffer.alloc(32, byte).toString("base64url"), activatedAt: timestamp, demotedAt: null, verificationCutoff: null, retiredAt: null }] });
  return {
    INTERNAL_PRINCIPAL_TTL_SECONDS: "60", INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: "5", INTERNAL_PRINCIPAL_ROTATION_OWNER: "security-auth",
    INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID: "finance", INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: keyring("finance", 1),
    INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID: "scheduler", INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON: keyring("scheduler", 2),
    INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: "workflow", INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: keyring("workflow", 3),
    INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID: "engineer", INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: keyring("engineer", 4),
  };
};
const userJwtEnv = () => {
  const timestamp = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const secret = Buffer.alloc(32, 9).toString("base64url");
  return {
    USER_JWT_ACTIVE_KID: "web-session", USER_JWT_ROTATION_OWNER: "security-auth", USER_JWT_ISSUER: "sangfor-os", USER_JWT_AUDIENCE: "sangfor-os-runtime", USER_JWT_TTL_SECONDS: "900", USER_JWT_CLOCK_SKEW_SECONDS: "30",
    USER_JWT_KEYRING_JSON: JSON.stringify({ version: "sangfor.user-jwt-keyring/v1", keys: [{ kid: "web-session", state: "active", secretBase64Url: secret, activatedAt: timestamp, demotedAt: null, verifyUntil: null, retiredAt: null }] }),
  };
};

beforeAll(() => {
  process.env.AUTH_BYPASS_ENABLED = "0";
  process.env.JWT_SECRET = "u002-finance-route-test-secret";
  process.env.FINANCE_API_KEY = "u002-finance-route-server-key-000000";
  Object.assign(process.env, protocolEnv());
  Object.assign(process.env, userJwtEnv());
});
afterAll(() => {
  if (prevBypass === undefined) delete process.env.AUTH_BYPASS_ENABLED;
  else process.env.AUTH_BYPASS_ENABLED = prevBypass;
  if (prevJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = prevJwtSecret;
  if (prevFinanceApiKey === undefined) delete process.env.FINANCE_API_KEY;
  else process.env.FINANCE_API_KEY = prevFinanceApiKey;
});

beforeEach(() => {
  dbMocks.projectFindUnique.mockResolvedValue({ id: ADMIN_USER.projectId, companyId: "finance-company", company: { tenantId: "finance-tenant" } });
  dbMocks.authSessionFindFirst.mockResolvedValue({ id: "finance-session-1", tenantId: "finance-tenant", companyId: "finance-company", projectId: ADMIN_USER.projectId });
  dbMocks.userCompanyRoleFindMany.mockResolvedValue([{ id: "finance-role-1", userId: ADMIN_USER.id, companyId: "finance-company", role: "finance_manager", status: "active", validFrom: null, expiresAt: null, revokedAt: null }]);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function financeReq(path = "/api/finance/invoices", authenticated = true): NextRequest {
  const headers = authenticated
    ? { authorization: `Bearer ${createSessionToken(ADMIN_USER)}` }
    : undefined;
  return new NextRequest(`http://localhost:3101${path}`, { headers });
}

function financePostReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3101/api/finance/invoices", {
    method: "POST",
    headers: {
      authorization: `Bearer ${createSessionToken(ADMIN_USER)}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("GET /api/finance/[...path]", () => {
  it("replaces a caller-supplied envelope and forwards a freshly signed human principal instead", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => "{}" });
    vi.stubGlobal("fetch", fetchMock);

    const request = financeReq();
    request.headers.set("x-sangfor-internal-principal", "forged.unsigned.principal");
    const res = await GET(request);

    expect(res.status).toBe(200);
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init).toEqual(expect.objectContaining({
      headers: expect.objectContaining({
        "X-Sangfor-Internal-Principal": expect.stringMatching(/^[^.]+\.[^.]+\.[^.]+$/),
      }),
    }));
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["X-Sangfor-Internal-Principal"]).not.toBe("forged.unsigned.principal");
    expect(headers).not.toHaveProperty("X-Actor-Id");
    expect(headers).not.toHaveProperty("X-Business-Role");
  });

  it("returns 503 before fetch when FINANCE_API_KEY is missing", async () => {
    // Given: an authenticated finance proxy with no dedicated upstream key.
    vi.stubEnv("FINANCE_API_KEY", "   ");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // When: the request reaches the Web route.
    const res = await GET(financeReq());

    // Then: configuration failure is explicit and no upstream request occurs.
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ error: "AUTH_CONFIGURATION_UNAVAILABLE" });
    expect(fetchMock).toHaveBeenCalledTimes(0);
    vi.stubEnv("FINANCE_API_KEY", "u002-finance-route-server-key-000000");
  });

  it("rejects an unauthenticated proxy request before upstream fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(financeReq("/api/finance/invoices", false));

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("returns 502 when upstream returns non-JSON body (e.g. HTML)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => '<html>\n<body>\n<h1>Gateway Timeout</h1>\n</body>\n</html>',
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(financeReq());

    expect(res.status).toBe(502);
    // Round 7 security: raw upstream text must never leak to the client.
    const raw = await res.text();
    expect(raw).not.toContain("Gateway Timeout");
    expect(raw).not.toContain("<html>");

    const body = JSON.parse(raw);
    expect(body).toEqual({ error: "upstream_unavailable" });
  });

  it("passes through a valid JSON response unchanged", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ invoices: [{ id: "INV-001", amount: 1500 }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(financeReq());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ invoices: [{ id: "INV-001", amount: 1500 }] });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Sangfor-Internal-Principal": expect.stringMatching(/^[^.]+\.[^.]+\.[^.]+$/),
        }),
      }),
    );
  });

  it("passes through a non-200 JSON response with upstream status intact", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 404,
      text: async () => JSON.stringify({ error: "not_found" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(financeReq());
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ error: "not_found" });
  });

  it("returns 502 when the upstream is unreachable (fetch throws)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(financeReq());
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body).toEqual({ error: "upstream_unavailable" });
  });

  it.each(CONFLICT_CASES)("rejects conflicting %s before fetch", async (_label, body) => {
    // Given: an authenticated operator and one caller-controlled identity field.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // When: a mutating finance request is submitted.
    const res = await POST(financePostReq(body));

    // Then: the conflict is rejected before serialization or upstream access.
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "IDENTITY_CONFLICT" });
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("strips equal identity fields recursively before upstream serialization", async () => {
    // Given: all eight identity fields match the verified principal at object/array positions.
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, text: async () => "{}" });
    vi.stubGlobal("fetch", fetchMock);
    const body = {
      approvedBy: ADMIN_USER.id,
      nested: {
        actorId: ADMIN_USER.id,
        requestedBy: ADMIN_USER.id,
        values: [
          { requester: ADMIN_USER.id, approver: ADMIN_USER.id },
          { approverId: ADMIN_USER.id, approverPersonaId: ADMIN_USER.id, personaId: ADMIN_USER.id },
        ],
      },
      keep: "value",
    };

    // When: the authenticated POST crosses the proxy.
    const res = await POST(financePostReq(body));

    // Then: only non-identity data is serialized to the finance API.
    expect(res.status).toBe(200);
    const call = fetchMock.mock.calls[0];
    expect(call?.[1]).toEqual(expect.objectContaining({
      body: expect.any(String),
      headers: expect.objectContaining({ "X-API-Key": "u002-finance-route-server-key-000000" }),
    }));
    const init = call?.[1];
    if (!init || typeof init !== "object" || !("body" in init) || typeof init.body !== "string") {
      throw new TypeError("Expected serialized finance proxy body");
    }
    expect(JSON.parse(init.body)).toEqual({ keep: "value", nested: { values: [{}, {}] } });
  });
});
