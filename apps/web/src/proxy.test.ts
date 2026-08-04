import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const prismaMocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  authSessionFindUnique: vi.fn(),
  authSessionCreate: vi.fn(),
  credentialLockQuery: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  Prisma: { sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })) },
  prisma: {
    user: { findUnique: prismaMocks.userFindUnique },
    authSession: {
      findUnique: prismaMocks.authSessionFindUnique,
      create: prismaMocks.authSessionCreate,
    },
    $transaction: prismaMocks.transaction,
  },
}));

import { createPersistedSession } from "@/lib/auth/persisted-session";
import { createSessionToken } from "@/lib/auth/session";
import { proxy } from "./proxy";

const USER_JWT_ENV_KEYS = [
  "USER_JWT_ACTIVE_KID",
  "USER_JWT_ROTATION_OWNER",
  "USER_JWT_ISSUER",
  "USER_JWT_AUDIENCE",
  "USER_JWT_TTL_SECONDS",
  "USER_JWT_CLOCK_SKEW_SECONDS",
  "USER_JWT_KEYRING_JSON",
  "NODE_ENV",
] as const;
type EnvKey = (typeof USER_JWT_ENV_KEYS)[number];
type EnvSnapshot = Partial<Record<EnvKey, string | undefined>>;

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const key of USER_JWT_ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap: EnvSnapshot) {
  for (const key of USER_JWT_ENV_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else setEnv(key, snap[key]);
  }
}

// NODE_ENV is typed read-only on ProcessEnv in this repo's @types/node; go
// through an untyped view of process.env to set it for these tests only.
function setEnv(key: EnvKey, value: string) {
  (process.env as Record<string, string | undefined>)[key] = value;
}

function clearUserJwtEnv() {
  for (const key of USER_JWT_ENV_KEYS) delete (process.env as Record<string, string | undefined>)[key];
}

function setValidUserJwtEnv() {
  const secret = Buffer.alloc(32, 4).toString("base64url");
  const activatedAt = new Date(Date.now() - 60_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  setEnv("USER_JWT_ACTIVE_KID", "proxy-test-key-1");
  setEnv("USER_JWT_ROTATION_OWNER", "security-auth");
  setEnv("USER_JWT_ISSUER", "sangfor-os");
  setEnv("USER_JWT_AUDIENCE", "sangfor-os-runtime");
  setEnv("USER_JWT_TTL_SECONDS", "28800");
  setEnv("USER_JWT_CLOCK_SKEW_SECONDS", "30");
  setEnv(
    "USER_JWT_KEYRING_JSON",
    JSON.stringify({
      version: "sangfor.user-jwt-keyring/v1",
      keys: [
        {
          kid: "proxy-test-key-1",
          state: "active",
          secretBase64Url: secret,
          activatedAt,
          demotedAt: null,
          verifyUntil: null,
          retiredAt: null,
        },
      ],
    }),
  );
}

const ACTIVE_USER = { id: "u1", status: "active", disabledAt: null };

async function persistedToken(): Promise<string> {
  prismaMocks.authSessionCreate.mockResolvedValueOnce({});
  const { token, jti } = await createPersistedSession({
    userId: "u1",
    tenantId: "tenant-1",
    companyId: "company-1",
    projectId: "project-1",
    projectSlug: "demo-project",
    role: "admin",
    credentialVersion: 1,
  });
  prismaMocks.authSessionFindUnique.mockResolvedValue({
    id: jti,
    userId: "u1",
    tenantId: "tenant-1",
    companyId: "company-1",
    projectId: "project-1",
    issuedAt: new Date(),
    expiresAt: new Date(Date.now() + 900_000),
    revokedAt: null,
    mfaVerifiedAt: null,
    mfaMethod: null,
  });
  prismaMocks.userFindUnique.mockResolvedValue(ACTIVE_USER);
  return token;
}

function req(path: string, init: { method?: string; cookie?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  return new NextRequest(new URL(path, "http://localhost:3110"), {
    method: init.method ?? "GET",
    headers,
  });
}

function isPassthrough(res: Response): boolean {
  return res.headers.get("x-middleware-next") === "1";
}

describe("proxy (Next.js proxy/middleware convention — apps/web/src/proxy.ts)", () => {
  let snap: EnvSnapshot;

  beforeEach(() => {
    snap = snapshotEnv();
    vi.clearAllMocks();
    prismaMocks.credentialLockQuery.mockResolvedValue([{ credential_version: 1 }]);
    prismaMocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $queryRaw: prismaMocks.credentialLockQuery,
      authSession: { create: prismaMocks.authSessionCreate },
    }));
  });

  afterEach(() => {
    restoreEnv(snap);
  });

  describe("when the USER_JWT_* keyring is unset (dev/demo, unconfigured)", () => {
    beforeEach(() => {
      clearUserJwtEnv();
    });

    it("passes reads through regardless of NODE_ENV", async () => {
      setEnv("NODE_ENV", "production");
      const res = await proxy(req("/api/opportunities", { method: "GET" }));
      expect(isPassthrough(res)).toBe(true);
    });

    it("passes mutations through in development (today's dev/demo posture)", async () => {
      setEnv("NODE_ENV", "development");
      const res = await proxy(req("/api/opportunities", { method: "POST" }));
      expect(isPassthrough(res)).toBe(true);
    });

    it("blocks a mutation with 503 in production (fail closed, not open)", async () => {
      setEnv("NODE_ENV", "production");
      const res = await proxy(req("/api/opportunities", { method: "DELETE" }));
      expect(res.status).toBe(503);
      await expect(res.json()).resolves.toMatchObject({ error: "service_unavailable" });
    });

    it("still allows a mutation to the login endpoint in production", async () => {
      setEnv("NODE_ENV", "production");
      const res = await proxy(req("/api/auth/login", { method: "POST" }));
      expect(isPassthrough(res)).toBe(true);
    });

    it("still strips a client-supplied internal-context header even when unconfigured", async () => {
      setEnv("NODE_ENV", "development");
      const res = await proxy(
        req("/api/opportunities", { method: "GET", headers: { "x-sangfor-internal-context": "forged.header" } }),
      );
      expect(isPassthrough(res)).toBe(true);
    });
  });

  describe("when the USER_JWT_* keyring is configured", () => {
    beforeEach(() => {
      setValidUserJwtEnv();
    });

    it("rejects an unauthenticated request to a non-public API route with 401", async () => {
      const res = await proxy(req("/api/opportunities", { method: "GET" }));
      expect(res.status).toBe(401);
    });

    it("rejects a request bearing an invalid session token", async () => {
      const res = await proxy(
        req("/api/opportunities", { method: "GET", cookie: "session=not.valid.token" }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a request bearing a legacy 2-segment session token", async () => {
      const token = createSessionToken({
        id: "u1",
        email: "a@b.com",
        role: "admin",
        projectId: "project-1",
        projectSlug: "demo-project",
      });
      const [header, payload] = token.split(".");
      const res = await proxy(
        req("/api/opportunities", { method: "GET", cookie: `session=${header}.${payload}` }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a cryptographically valid token that has no DB session (U014 — a signed JWT alone is not enough)", async () => {
      const token = createSessionToken({
        id: "u1",
        email: "a@b.com",
        role: "admin",
        projectId: "project-1",
        projectSlug: "demo-project",
      });
      prismaMocks.authSessionFindUnique.mockResolvedValueOnce(null);
      const res = await proxy(
        req("/api/opportunities", { method: "GET", cookie: `session=${token}` }),
      );
      expect(res.status).toBe(401);
    });

    it("rejects a still-valid JWT once the session is revoked", async () => {
      const token = await persistedToken();
      prismaMocks.authSessionFindUnique.mockResolvedValueOnce({
        id: "revoked-jti",
        userId: "u1",
        tenantId: "tenant-1",
        companyId: "company-1",
        projectId: "project-1",
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + 900_000),
        revokedAt: new Date(),
        mfaVerifiedAt: null,
        mfaMethod: null,
      });
      const res = await proxy(req("/api/opportunities", { method: "GET", cookie: `session=${token}` }));
      expect(res.status).toBe(401);
    });

    it("rejects a still-valid JWT once the user is disabled — denied on the very next request", async () => {
      const token = await persistedToken();
      prismaMocks.userFindUnique.mockResolvedValueOnce({ id: "u1", status: "disabled", disabledAt: new Date() });
      const res = await proxy(req("/api/opportunities", { method: "GET", cookie: `session=${token}` }));
      expect(res.status).toBe(401);
    });

    it("passes a request with a persisted, active session and forwards a signed internal context (never the client's)", async () => {
      const token = await persistedToken();
      const res = await proxy(
        req("/api/opportunities", {
          method: "GET",
          cookie: `session=${token}`,
          headers: { "x-sangfor-internal-context": "client-forged-value" },
        }),
      );
      expect(isPassthrough(res)).toBe(true);
    });

    it("passes a request with a valid Bearer session token backed by a persisted session", async () => {
      const token = await persistedToken();
      const headers = new Headers();
      headers.set("authorization", `Bearer ${token}`);
      const res = await proxy(
        new NextRequest(new URL("/api/opportunities", "http://localhost:3110"), { method: "GET", headers }),
      );
      expect(isPassthrough(res)).toBe(true);
    });

    it("lets the health check through without a session", async () => {
      const res = await proxy(req("/api/health", { method: "GET" }));
      expect(isPassthrough(res)).toBe(true);
    });

    it("lets the Outlook OAuth callback through without a session", async () => {
      const res = await proxy(
        req("/api/mail/oauth/callback?code=x&state=y", { method: "GET" }),
      );
      expect(isPassthrough(res)).toBe(true);
    });
  });
});
