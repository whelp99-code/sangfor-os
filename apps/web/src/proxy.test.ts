import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

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
  setEnv("USER_JWT_TTL_SECONDS", "900");
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

function req(path: string, init: { method?: string; cookie?: string } = {}) {
  const headers = new Headers();
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

    it("passes a request with a valid session token", async () => {
      const token = createSessionToken({
        id: "u1",
        email: "a@b.com",
        role: "admin",
        projectId: "project-1",
        projectSlug: "demo-project",
      });
      const res = await proxy(
        req("/api/opportunities", { method: "GET", cookie: `session=${token}` }),
      );
      expect(isPassthrough(res)).toBe(true);
    });

    it("passes a request with a valid Bearer session token", async () => {
      const token = createSessionToken({
        id: "u1",
        email: "a@b.com",
        role: "admin",
        projectId: "project-1",
        projectSlug: "demo-project",
      });
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
