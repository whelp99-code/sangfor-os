/**
 * U006 — Process environment profiles (local | test | production).
 *
 * Production fail-closed predicates mirror U002 (replicated — nested service
 * packages are not cleanly importable from monorepo packages/config):
 * - services/sangfor-engineer-mcp/packages/shared/src/mutation-policy.ts
 *   `productionAuthConfigurationIssues`
 * - services/sangfor-mcp-workflow/packages/shared/src/mutation-policy.ts
 *   `assertSafeWorkflowConfiguration` / bypass + safe-tools + required keys
 */

export const PROCESS_PROFILES = ["local", "test", "production"] as const;
export type ProcessProfileName = (typeof PROCESS_PROFILES)[number];

export const PROCESS_NAMES = [
  "web",
  "api",
  "engineer-bridge",
  "engineer-mcp",
  "workflow-operator",
  "workflow-mcp",
] as const;
export type ProcessName = (typeof PROCESS_NAMES)[number];

/** U002 engineer API_KEY_BYPASS_FIELDS (exact set). */
const API_KEY_BYPASS_FIELDS = [
  "AUTH_BYPASS_ENABLED",
  "API_KEY_BYPASS_ENABLED",
  "API_KEY_AUTH_BYPASS_ENABLED",
  "MCP_API_KEY_BYPASS_ENABLED",
] as const;

/** Workflow-side bypass names also rejected in production. */
const WORKFLOW_BYPASS_FIELDS = [
  "SANGFOR_API_KEY_BYPASS",
  "MCP_AUTH_BYPASS_ENABLED",
] as const;

const PLACEHOLDER_RE =
  /^(change.?me|placeholder|xxx+|your[-_].+|todo|replace.?me|secret|password|test[-_]?key)$/i;

export class ProcessProfileError extends Error {
  readonly name = "ProcessProfileError";
  readonly code = "PROCESS_PROFILE_VALIDATION_FAILED";
  readonly exitCode = 78;

  constructor(readonly issues: readonly string[]) {
    super(`PROCESS_PROFILE_VALIDATION_FAILED: ${issues.join("; ")}`);
  }
}

function isTruthyFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function isNonBlank(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlaceholderSecret(value: string | undefined): boolean {
  if (!isNonBlank(value)) return false;
  const trimmed = value!.trim();
  if (PLACEHOLDER_RE.test(trimmed)) return true;
  if (/placeholder/i.test(trimmed)) return true;
  return false;
}

export function resolveProcessProfile(
  env: NodeJS.ProcessEnv = process.env,
): ProcessProfileName {
  const raw = (
    env.SANGFOR_PROCESS_PROFILE ??
    env.PROCESS_PROFILE ??
    ""
  )
    .trim()
    .toLowerCase();
  if (raw === "local" || raw === "test" || raw === "production") return raw;
  if (env.NODE_ENV === "production") return "production";
  if (env.NODE_ENV === "test") return "test";
  return "local";
}

/** Feature flags — disabled features do not force their external secrets. */
export function isFeatureEnabled(
  feature: "microsoft_graph" | "github" | "slack" | "outlook",
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  switch (feature) {
    case "microsoft_graph":
      return (
        isTruthyFlag(env.MICROSOFT_GRAPH_ENABLED) ||
        isTruthyFlag(env.MAIL_INTELLIGENCE_ENABLED)
      );
    case "github":
      return isTruthyFlag(env.GITHUB_ENABLED);
    case "slack":
      return isTruthyFlag(env.SLACK_ENABLED);
    case "outlook":
      return isTruthyFlag(env.OUTLOOK_ENABLED);
    default:
      return false;
  }
}

/**
 * Replicated from U002 `productionAuthConfigurationIssues` (engineer mutation-policy).
 * Applied when profile is production (not only when NODE_ENV already is).
 */
export function productionAuthConfigurationIssues(
  env: NodeJS.ProcessEnv,
): readonly string[] {
  const issues: string[] = [];
  for (const field of API_KEY_BYPASS_FIELDS) {
    if (isTruthyFlag(env[field])) issues.push(field);
  }
  if (env.WHELP99_ENFORCE_SAFE_TOOLS !== "true") {
    issues.push("WHELP99_ENFORCE_SAFE_TOOLS");
  }
  if (!env.SANGFOR_API_KEY?.trim()) issues.push("SANGFOR_API_KEY");
  if (!env.SANGFOR_OPERATOR_PRINCIPAL_ID?.trim()) {
    issues.push("SANGFOR_OPERATOR_PRINCIPAL_ID");
  }
  return issues;
}

/**
 * Replicated from U002 `assertSafeWorkflowConfiguration` predicate set
 * (workflow mutation-policy): bypasses off, safe-tools true, both API keys + principal.
 */
export function workflowProductionConfigurationIssues(
  env: NodeJS.ProcessEnv,
): readonly string[] {
  const issues: string[] = [];
  if (isTruthyFlag(env.AUTH_BYPASS_ENABLED)) issues.push("AUTH_BYPASS_ENABLED");
  if (
    isTruthyFlag(env.API_KEY_BYPASS_ENABLED) ||
    isTruthyFlag(env.SANGFOR_API_KEY_BYPASS) ||
    isTruthyFlag(env.MCP_AUTH_BYPASS_ENABLED)
  ) {
    issues.push("api-key bypass enabled");
  }
  const safeTools = env.WHELP99_ENFORCE_SAFE_TOOLS?.trim();
  if (!safeTools || safeTools !== "true") {
    issues.push("WHELP99_ENFORCE_SAFE_TOOLS");
  }
  if (!isNonBlank(env.SANGFOR_API_KEY)) issues.push("SANGFOR_API_KEY");
  if (!isNonBlank(env.MCP_API_KEY)) issues.push("MCP_API_KEY");
  if (!isNonBlank(env.SANGFOR_OPERATOR_PRINCIPAL_ID)) {
    issues.push("SANGFOR_OPERATOR_PRINCIPAL_ID");
  }
  return issues;
}

function productionCriticalKeys(processName: ProcessName): readonly string[] {
  switch (processName) {
    case "web":
      return []; // JWT/NEXTAUTH handled specially
    case "api":
      return [
        "API_KEY",
        "FINANCE_API_KEY",
        "SANGFOR_API_KEY",
        "SANGFOR_OPERATOR_PRINCIPAL_ID",
      ];
    case "engineer-bridge":
    case "engineer-mcp":
      return ["SANGFOR_API_KEY", "SANGFOR_OPERATOR_PRINCIPAL_ID"];
    case "workflow-operator":
    case "workflow-mcp":
      return [
        "SANGFOR_API_KEY",
        "MCP_API_KEY",
        "SANGFOR_OPERATOR_PRINCIPAL_ID",
      ];
    default:
      return [];
  }
}

function collectFeatureSecretIssues(env: NodeJS.ProcessEnv): string[] {
  const issues: string[] = [];
  if (isFeatureEnabled("microsoft_graph", env)) {
    for (const key of [
      "MICROSOFT_TENANT_ID",
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
    ]) {
      if (!isNonBlank(env[key])) {
        issues.push(`missing ${key} (microsoft_graph enabled)`);
      }
    }
  }
  if (isFeatureEnabled("github", env) && !isNonBlank(env.GITHUB_TOKEN)) {
    issues.push("missing GITHUB_TOKEN (github enabled)");
  }
  if (isFeatureEnabled("slack", env) && !isNonBlank(env.SLACK_BOT_TOKEN)) {
    issues.push("missing SLACK_BOT_TOKEN (slack enabled)");
  }
  if (isFeatureEnabled("outlook", env)) {
    for (const key of [
      "OUTLOOK_CLIENT_ID",
      "OUTLOOK_CLIENT_SECRET",
      "OUTLOOK_TENANT_ID",
    ]) {
      if (!isNonBlank(env[key])) {
        issues.push(`missing ${key} (outlook enabled)`);
      }
    }
  }
  return issues;
}

function collectProductionSafetyIssues(
  processName: ProcessName,
  env: NodeJS.ProcessEnv,
): string[] {
  const issues: string[] = [];

  // Mock auth forbidden in production (all processes)
  if (env.AUTH_PROFILE === "local_mock") {
    issues.push("AUTH_PROFILE=local_mock");
  }

  // Generic bypass fields
  for (const field of API_KEY_BYPASS_FIELDS) {
    if (isTruthyFlag(env[field])) issues.push(field);
  }
  for (const field of WORKFLOW_BYPASS_FIELDS) {
    if (isTruthyFlag(env[field])) issues.push(field);
  }

  // Placeholder secrets on common credential keys
  for (const key of [
    "SANGFOR_API_KEY",
    "MCP_API_KEY",
    "API_KEY",
    "FINANCE_API_KEY",
    "JWT_SECRET",
    "NEXTAUTH_SECRET",
  ]) {
    if (isPlaceholderSecret(env[key])) {
      issues.push(`${key}:placeholder`);
    }
  }

  if (processName === "web") {
    if (isNonBlank(env.AUTH_DEMO_PASSWORD)) {
      issues.push("AUTH_DEMO_PASSWORD forbidden in production");
    }
    if (!isNonBlank(env.JWT_SECRET) && !isNonBlank(env.NEXTAUTH_SECRET)) {
      issues.push("missing JWT_SECRET|NEXTAUTH_SECRET (production)");
    }
    return issues;
  }

  if (processName === "workflow-operator" || processName === "workflow-mcp") {
    issues.push(...workflowProductionConfigurationIssues(env));
    return issues;
  }

  // api + engineer processes: engineer-style U002 productionAuthConfigurationIssues
  issues.push(...productionAuthConfigurationIssues(env));
  return issues;
}

export type ProcessProfileValidation = {
  readonly profile: ProcessProfileName;
  readonly processName: ProcessName;
  readonly ok: true;
};

/**
 * Validate required env for a process under a profile.
 * - local/test: do not force external feature secrets when features are disabled
 * - production (or enabled feature): missing critical env → ProcessProfileError
 */
export function validateProcessProfile(
  processName: ProcessName,
  env: NodeJS.ProcessEnv = process.env,
  profile: ProcessProfileName = resolveProcessProfile(env),
): ProcessProfileValidation {
  if (!PROCESS_NAMES.includes(processName)) {
    throw new ProcessProfileError([`unknown process: ${String(processName)}`]);
  }
  if (!PROCESS_PROFILES.includes(profile)) {
    throw new ProcessProfileError([`unknown profile: ${String(profile)}`]);
  }

  const issues: string[] = [];

  // Feature-gated secrets (any profile)
  issues.push(...collectFeatureSecretIssues(env));

  if (profile === "production") {
    for (const key of productionCriticalKeys(processName)) {
      if (!isNonBlank(env[key])) {
        issues.push(`missing ${key} (production)`);
      }
    }
    issues.push(...collectProductionSafetyIssues(processName, env));
  }

  // Deduplicate while preserving order
  const unique = [...new Set(issues)];
  if (unique.length > 0) {
    throw new ProcessProfileError(unique);
  }

  return { profile, processName, ok: true };
}

export function assertProcessProfile(
  processName: ProcessName,
  env: NodeJS.ProcessEnv = process.env,
  profile?: ProcessProfileName,
): ProcessProfileValidation {
  return validateProcessProfile(
    processName,
    env,
    profile ?? resolveProcessProfile(env),
  );
}

/**
 * Production preflight for evidence / startup. Always evaluates the production
 * profile (even if the process env is stripped). Writes a redacted code line
 * and exits 78 on failure — secrets are never written.
 */
export function runProductionPreflight(
  processName: ProcessName = "api",
  env: NodeJS.ProcessEnv = process.env,
): void {
  try {
    validateProcessProfile(
      processName,
      env,
      "production",
    );
  } catch (error) {
    if (error instanceof ProcessProfileError) {
      // Codes only — never secret values
      process.stderr.write(
        `UNSAFE_AUTH_CONFIGURATION\n${error.issues.join("\n")}\n`,
      );
      process.exit(78);
    }
    throw error;
  }
}

/** Matrix helper for evidence (profile × process × sample outcomes). */
export function buildProfileMatrix(): Array<{
  profile: ProcessProfileName;
  processName: ProcessName;
  requiresExternalSecretsWhenDisabled: false;
  productionFailClosed: boolean;
}> {
  return PROCESS_PROFILES.flatMap((profile) =>
    PROCESS_NAMES.map((processName) => ({
      profile,
      processName,
      requiresExternalSecretsWhenDisabled: false as const,
      productionFailClosed: profile === "production",
    })),
  );
}
