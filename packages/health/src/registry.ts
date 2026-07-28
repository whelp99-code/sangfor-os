/**
 * @sangfor/health — Canonical health registry (U006).
 *
 * Single owner of criticality / enabled predicates / remediation.
 * Transport/probe is delegated to @sangfor/infra (do not add a second registry).
 * Target URLs derive from U003 PORT_REGISTRY via infra resolve + env overrides.
 */

import {
  getIntegrationTarget,
  probeIntegrationTarget,
  type IntegrationTarget,
  type ProbeOptions,
} from "@sangfor/infra";
import { resolveProcessProfile, type ProcessProfileName } from "@sangfor/config";

export type HealthCriticality = "critical" | "optional";

/** Status values exposed on the unified-health API. */
export type UnifiedHealthStatus =
  | "ok"
  | "degraded"
  | "error"
  | "disabled"
  | "unknown";

export type HealthRegistryEntry = {
  readonly id: string;
  readonly name: string;
  readonly ownerWorkspace: string;
  /** Infra integration target id (same stable id). */
  readonly integrationTargetId: string;
  /** Env var that may override the base URL (documentational + redaction-safe). */
  readonly envSource: string;
  readonly criticality: HealthCriticality;
  readonly timeoutMs: number;
  /** Redaction-safe operator remediation text (no secrets). */
  readonly remediation: string;
  /** Whether this target is enabled for the given env/profile. */
  readonly enabledPredicate: (
    env: NodeJS.ProcessEnv,
    profile: ProcessProfileName,
  ) => boolean;
};

export type UnifiedServiceHealth = {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly status: UnifiedHealthStatus;
  readonly criticality: HealthCriticality;
  readonly ownerWorkspace: string;
  readonly remediation: string;
  readonly latencyMs?: number;
  readonly detail?: string;
};

export type UnifiedHealthReport = {
  readonly httpStatus: 200 | 503;
  readonly overall: "ok" | "degraded" | "error";
  readonly summary: {
    readonly total: number;
    readonly ok: number;
    readonly degraded: number;
    readonly error: number;
    readonly disabled: number;
    readonly timestamp: string;
  };
  readonly services: readonly UnifiedServiceHealth[];
  readonly timestamp: string;
};

export type ProbeCanonicalOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetchImpl?: typeof fetch;
  /** Injectable clock (tests). */
  readonly now?: () => number;
  /** Optional per-call timeout override. */
  readonly timeoutMs?: number;
};

const SECRET_KEY_RE =
  /(?:api[-_]?key|authorization|password|secret|token|credential|passwd|pwd)/i;

function isDisabledFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off" || v === "disabled";
}

function isEnabledFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Canonical registry entries. Integration target ids match packages/infra REGISTRY.
 */
export const HEALTH_REGISTRY: readonly HealthRegistryEntry[] = [
  {
    id: "whelp99-code-sangfor-engineer-mcp",
    name: "Engineer MCP HTTP bridge",
    ownerWorkspace: "services/sangfor-engineer-mcp",
    integrationTargetId: "whelp99-code-sangfor-engineer-mcp",
    envSource: "WHELP99_MCP_HTTP_URL",
    criticality: "critical",
    timeoutMs: 3000,
    remediation:
      "Ensure engineer MCP HTTP bridge is listening on WHELP99_MCP_BRIDGE (default 3600); check WHELP99_MCP_HTTP_URL override.",
    enabledPredicate: (env) =>
      !isDisabledFlag(env.HEALTH_ENGINEER_BRIDGE_ENABLED),
  },
  {
    id: "sangfor-mcp-workflow",
    name: "Sangfor MCP workflow",
    ownerWorkspace: "services/sangfor-mcp-workflow",
    integrationTargetId: "sangfor-mcp-workflow",
    envSource: "SANGFOR_MCP_URL",
    criticality: "critical",
    timeoutMs: 3000,
    remediation:
      "Ensure sangfor-mcp-workflow is listening on SANGFOR_MCP (default 3500); check SANGFOR_MCP_URL override.",
    enabledPredicate: (env) =>
      !isDisabledFlag(env.HEALTH_WORKFLOW_ENABLED),
  },
  {
    id: "sangfor-engineer-operator-console",
    name: "Engineer operator console",
    ownerWorkspace: "services/sangfor-mcp-workflow",
    integrationTargetId: "sangfor-engineer-operator-console",
    envSource: "WHELP99_OPERATOR_CONSOLE_URL",
    criticality: "optional",
    timeoutMs: 3000,
    remediation:
      "Optional operator console on WHELP99_OPERATOR_CONSOLE (default 3502). Disable with HEALTH_OPERATOR_CONSOLE_ENABLED=0.",
    enabledPredicate: (env, profile) => {
      if (isDisabledFlag(env.HEALTH_OPERATOR_CONSOLE_ENABLED)) return false;
      if (profile === "production" && !isEnabledFlag(env.HEALTH_OPERATOR_CONSOLE_ENABLED)) {
        return false;
      }
      return true;
    },
  },
  {
    id: "sangfor-mock-console",
    name: "Mock Sangfor console",
    ownerWorkspace: "services/sangfor-engineer-mcp",
    integrationTargetId: "sangfor-mock-console",
    envSource: "SANGFOR_MOCK_CONSOLE_URL",
    criticality: "optional",
    timeoutMs: 2000,
    remediation:
      "Optional mock console on SANGFOR_MOCK_CONSOLE (default 3400). Disable with SANGFOR_MOCK_CONSOLE_ENABLED=0 or HEALTH_MOCK_CONSOLE_ENABLED=0.",
    enabledPredicate: (env, profile) => {
      if (
        isDisabledFlag(env.SANGFOR_MOCK_CONSOLE_ENABLED) ||
        isDisabledFlag(env.HEALTH_MOCK_CONSOLE_ENABLED)
      ) {
        return false;
      }
      // Production never enables mock console unless explicitly forced
      if (profile === "production") return false;
      return true;
    },
  },
] as const;

export const FAKE_HEALTH_DOMAIN_PATTERN = /\.sangfor\.internal\b/i;

/** Redact credentials and secret-like query/userinfo from a URL for response bodies. */
export function redactHealthUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (SECRET_KEY_RE.test(key)) parsed.searchParams.delete(key);
    }
    // Avoid trailing empty auth noise
    return parsed.toString().replace(/\/\/@/, "//");
  } catch {
    return "[invalid-url]";
  }
}

/** Strip known secret substrings from free text (probe body / error messages). */
export function redactHealthText(
  text: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!text) return text;
  let out = text;
  const candidates = [
    env.SANGFOR_API_KEY,
    env.MCP_API_KEY,
    env.API_KEY,
    env.FINANCE_API_KEY,
    env.JWT_SECRET,
    env.NEXTAUTH_SECRET,
    env.DATABASE_URL,
    env.REDIS_URL,
  ].filter((v): v is string => typeof v === "string" && v.length >= 4);

  for (const secret of candidates) {
    if (out.includes(secret)) {
      out = out.split(secret).join("[REDACTED]");
    }
  }
  // Drop obvious authorization headers if a probe echoed them
  out = out.replace(
    /(authorization|x-api-key|x-sangfor-api-key)\s*[:=]\s*\S+/gi,
    "$1:[REDACTED]",
  );
  return out;
}

function mapProbeStatus(
  status: IntegrationTarget["status"],
): UnifiedHealthStatus {
  switch (status) {
    case "healthy":
      return "ok";
    case "degraded":
      return "degraded";
    case "unreachable":
      return "error";
    case "unknown":
    default:
      return "unknown";
  }
}

export function listHealthRegistryEntries(): readonly HealthRegistryEntry[] {
  return HEALTH_REGISTRY;
}

export function getHealthRegistryEntry(
  id: string,
): HealthRegistryEntry | undefined {
  return HEALTH_REGISTRY.find((e) => e.id === id);
}

/**
 * Probe every registry entry with injectable fetch/clock.
 * Disabled optional targets return status `disabled` and are never counted healthy.
 * Enabled critical targets that are not ok force httpStatus 503 + overall degraded/error.
 */
export async function probeCanonicalHealth(
  opts: ProbeCanonicalOptions = {},
): Promise<UnifiedHealthReport> {
  const env = opts.env ?? process.env;
  const profile = resolveProcessProfile(env);
  const now = opts.now ?? (() => Date.now());
  const timestamp = new Date(now()).toISOString();

  const services: UnifiedServiceHealth[] = await Promise.all(
    HEALTH_REGISTRY.map(async (entry) => {
      const enabled = entry.enabledPredicate(env, profile);
      const resolved = getIntegrationTarget(entry.integrationTargetId);
      const safeUrl = redactHealthUrl(resolved.upstream);

      if (!enabled) {
        return {
          id: entry.id,
          name: entry.name,
          url: safeUrl,
          status: "disabled" as const,
          criticality: entry.criticality,
          ownerWorkspace: entry.ownerWorkspace,
          remediation: entry.remediation,
        };
      }

      const probeOpts: ProbeOptions = {
        timeoutMs: opts.timeoutMs ?? entry.timeoutMs,
        fetchImpl: opts.fetchImpl,
      };
      const probed = await probeIntegrationTarget(resolved, probeOpts);
      const status = mapProbeStatus(probed.status);
      return {
        id: entry.id,
        name: entry.name,
        url: safeUrl,
        status,
        criticality: entry.criticality,
        ownerWorkspace: entry.ownerWorkspace,
        remediation: entry.remediation,
        latencyMs: probed.latencyMs,
        detail: redactHealthText(probed.details, env),
      };
    }),
  );

  let ok = 0;
  let degraded = 0;
  let error = 0;
  let disabled = 0;
  let criticalFailure = false;

  for (const service of services) {
    if (service.status === "disabled") {
      disabled += 1;
      continue;
    }
    if (service.status === "ok") {
      ok += 1;
      continue;
    }
    if (service.status === "degraded") {
      degraded += 1;
      if (service.criticality === "critical") criticalFailure = true;
      continue;
    }
    // error | unknown
    error += 1;
    if (service.criticality === "critical") criticalFailure = true;
  }

  const overall: UnifiedHealthReport["overall"] = criticalFailure
    ? error > 0
      ? "error"
      : "degraded"
    : degraded > 0 || error > 0
      ? "degraded"
      : "ok";

  // Critical enabled unavailable → 503; otherwise 200
  const httpStatus: 200 | 503 = criticalFailure ? 503 : 200;

  // When critical failure with errors, prefer overall "error" if any error status present among critical
  const criticalError = services.some(
    (s) =>
      s.criticality === "critical" &&
      s.status !== "disabled" &&
      s.status !== "ok" &&
      s.status !== "degraded",
  );
  const finalOverall: UnifiedHealthReport["overall"] = criticalError
    ? "error"
    : overall === "error"
      ? "degraded"
      : overall;

  return {
    httpStatus,
    overall: criticalFailure
      ? criticalError
        ? "error"
        : "degraded"
      : finalOverall === "error"
        ? "degraded"
        : finalOverall,
    summary: {
      total: services.length,
      ok,
      degraded,
      error,
      disabled,
      timestamp,
    },
    services,
    timestamp,
  };
}
