import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { assertApiAccess, isAuthBypassEnabled } from "./api-auth";

const ENV_KEY = "AUTH_BYPASS_ENABLED";

describe("isAuthBypassEnabled", () => {
  it("is true only for an explicit '1' flag", () => {
    expect(isAuthBypassEnabled({ [ENV_KEY]: "1" })).toBe(true);
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
  const original = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("passes (returns null) when bypass is explicitly enabled", () => {
    process.env[ENV_KEY] = "1";
    expect(assertApiAccess(new Request("http://localhost/api/tasks"))).toBeNull();
  });

  it("returns a 401 response when the flag is absent", async () => {
    const res = assertApiAccess(new Request("http://localhost/api/tasks"));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    await expect(res!.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Authentication required",
    });
  });

  it("returns a 401 response when the flag is empty", () => {
    process.env[ENV_KEY] = "";
    const res = assertApiAccess(new Request("http://localhost/api/tasks"));
    expect(res?.status).toBe(401);
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
      if (!source.includes("assertApiAccess")) unguarded.push(rel);
    }
    expect(unguarded).toEqual([]);
  });
});
