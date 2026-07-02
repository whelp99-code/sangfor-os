import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { createSessionToken } from "@/lib/auth/session";
import { proxy } from "./proxy";

const ENV_KEYS = ["JWT_SECRET", "NODE_ENV"] as const;
type EnvKey = (typeof ENV_KEYS)[number];
type EnvSnapshot = Partial<Record<EnvKey, string | undefined>>;

function snapshotEnv(): EnvSnapshot {
  const snap: EnvSnapshot = {};
  for (const key of ENV_KEYS) snap[key] = process.env[key];
  return snap;
}

function restoreEnv(snap: EnvSnapshot) {
  for (const key of ENV_KEYS) {
    if (snap[key] === undefined) delete process.env[key];
    else setEnv(key, snap[key]);
  }
}

// NODE_ENV is typed read-only on ProcessEnv in this repo's @types/node; go
// through an untyped view of process.env to set it for these tests only.
function setEnv(key: EnvKey, value: string) {
  (process.env as Record<string, string | undefined>)[key] = value;
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

  describe("when JWT_SECRET is unset (dev/demo, unconfigured)", () => {
    beforeEach(() => {
      delete process.env.JWT_SECRET;
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

  describe("when JWT_SECRET is configured", () => {
    const secret = "a-test-secret-thats-long-enough";

    beforeEach(() => {
      process.env.JWT_SECRET = secret;
    });

    it("rejects an unauthenticated request to a non-public API route with 401", async () => {
      const res = await proxy(req("/api/opportunities", { method: "GET" }));
      expect(res.status).toBe(401);
    });

    it("rejects a request bearing an invalid session token", async () => {
      const res = await proxy(
        req("/api/opportunities", { method: "GET", cookie: "session=not.valid" }),
      );
      expect(res.status).toBe(401);
    });

    it("passes a request with a valid session token", async () => {
      const token = createSessionToken({ id: "u1", email: "a@b.com", role: "admin" });
      const res = await proxy(
        req("/api/opportunities", { method: "GET", cookie: `session=${token}` }),
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
