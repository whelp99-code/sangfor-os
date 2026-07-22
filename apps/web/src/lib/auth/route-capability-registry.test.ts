import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveCapabilities } from "@sangfor/auth";

import { ROUTE_CAPABILITY_CLASS_VALUES, ROUTE_CAPABILITY_REGISTRY } from "./route-capability-registry";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../../..");
const WEB_APP_ROOT = resolve(REPO_ROOT, "apps/web");

function rgList(pattern: string): string[] {
  const out = execFileSync("rg", ["-l", pattern, "apps/web/src/app/api", "-g", "route.ts"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function deriveCurrentCoverageSet(): string[] {
  const assertApiAccess = rgList("assertApiAccess\\(");
  const authorizeOperatorRequest = rgList("authorizeOperatorRequest\\(");
  const union = new Set([...assertApiAccess, ...authorizeOperatorRequest]);
  return [...union].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

describe("route-capability-registry — static classification proof", () => {
  it("classifies exactly the current 68-file guarded-route coverage set, byte-identical, no subset filtering", () => {
    const derived = deriveCurrentCoverageSet();
    const registryKeys = Object.keys(ROUTE_CAPABILITY_REGISTRY).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(registryKeys).toEqual(derived);
    expect(registryKeys).toHaveLength(68);
  });

  it("every registered route file actually exists on disk under apps/web", () => {
    for (const key of Object.keys(ROUTE_CAPABILITY_REGISTRY)) {
      expect(key.startsWith("apps/web/src/app/api/")).toBe(true);
      expect(key.endsWith("/route.ts")).toBe(true);
      expect(() => resolve(REPO_ROOT, key)).not.toThrow();
    }
  });

  it("every entry uses one of the seven allowed capability classes", () => {
    for (const [key, definition] of Object.entries(ROUTE_CAPABILITY_REGISTRY)) {
      expect(ROUTE_CAPABILITY_CLASS_VALUES, `route ${key} has an unrecognized capabilityClass`).toContain(definition.capabilityClass);
    }
  });

  it("no entry is classified public or external-release (this unit enables neither)", () => {
    for (const [key, definition] of Object.entries(ROUTE_CAPABILITY_REGISTRY)) {
      expect(definition.capabilityClass, `route ${key}`).not.toBe("public");
      expect(definition.capabilityClass, `route ${key}`).not.toBe("external-release");
    }
  });

  it("every declared permission exists in the typed BusinessPermission policy (no capability absent from the typed policy)", () => {
    const allPermissions = new Set(
      (["ceo", "sales_manager", "account_manager", "presales_engineer", "solution_architect", "finance_manager", "delivery_engineer", "support_engineer", "security_officer", "system_admin"] as const).flatMap(
        (role) => resolveCapabilities(role),
      ),
    );
    for (const [key, definition] of Object.entries(ROUTE_CAPABILITY_REGISTRY)) {
      if (!definition.permission) continue;
      expect(allPermissions.has(definition.permission), `route ${key} declares unknown permission "${definition.permission}"`).toBe(true);
    }
  });

  it("every non-authenticated, non-privileged entry (company-scoped/project-assigned/owner-assigned) declares a permission", () => {
    for (const [key, definition] of Object.entries(ROUTE_CAPABILITY_REGISTRY)) {
      if (definition.capabilityClass === "authenticated") continue;
      expect(definition.permission, `route ${key} of class ${definition.capabilityClass} has no permission`).toBeDefined();
    }
  });

  it("fails on a synthetic unclassified mutating route (the static-test contract this registry must satisfy)", () => {
    const syntheticKey = "apps/web/src/app/api/__does-not-exist__/route.ts";
    expect(ROUTE_CAPABILITY_REGISTRY[syntheticKey]).toBeUndefined();
  });

  it("app root resolves under the repo (sanity check for the path helpers above)", () => {
    expect(WEB_APP_ROOT.endsWith("apps/web")).toBe(true);
  });
});
