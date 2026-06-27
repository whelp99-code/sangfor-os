import { MODE_MATRIX, UNSAFE_ACTIONS, type RoleMode, type UnsafeAction } from "@sangfor/shared/modes";

export type StabilizationReadinessCheckKey =
  | "mode_matrix_defined"
  | "unsafe_actions_gated"
  | "mail_loop_verified"
  | "deal_quote_gate_defined"
  | "role_workspaces_visible"
  | "health_runbook_available"
  | "demo_seed_idempotent";

export type StabilizationReadinessCheck = {
  key: StabilizationReadinessCheckKey;
  title: string;
  track: "foundation" | "revenue" | "operations";
  verification: string;
};

export type StabilizationReadinessInput = {
  passedKeys: StabilizationReadinessCheckKey[];
};

export type StabilizationReadinessSummary = {
  status: "ready" | "in_progress";
  total: number;
  passed: number;
  remaining: StabilizationReadinessCheck[];
  checks: Array<StabilizationReadinessCheck & { passed: boolean }>;
  roleEntries: Array<{ role: RoleMode; dashboardPath: string; successScenario: string }>;
  blockedUnsafeActions: UnsafeAction[];
};

const W1_W2_CHECKS: readonly StabilizationReadinessCheck[] = [
  {
    key: "mode_matrix_defined",
    title: "Role, AI, and operating mode matrix is defined",
    track: "foundation",
    verification: "pnpm --dir packages/shared exec vitest run src/modes.test.ts",
  },
  {
    key: "unsafe_actions_gated",
    title: "Unsafe actions require approval by default",
    track: "foundation",
    verification: "Inspect shared mode matrix and security workspace unsafe action list",
  },
  {
    key: "mail_loop_verified",
    title: "Real-mail candidate approval loop is verified",
    track: "revenue",
    verification: "Run real-mail hardening runbook and focused mail candidate tests",
  },
  {
    key: "deal_quote_gate_defined",
    title: "Deal/quote commercial approval gate baseline is defined",
    track: "revenue",
    verification: "pnpm --dir packages/business exec vitest run src/commercial-approval.test.ts",
  },
  {
    key: "role_workspaces_visible",
    title: "Role workspace entry points are visible",
    track: "operations",
    verification: "Open /operator and /security in the local web app",
  },
  {
    key: "health_runbook_available",
    title: "Health and observability runbook is available",
    track: "operations",
    verification: "bash scripts/health-check.sh with local stack running",
  },
  {
    key: "demo_seed_idempotent",
    title: "Demo seed is deterministic and idempotent",
    track: "operations",
    verification: "pnpm db:seed && pnpm db:seed",
  },
] as const;

export function listW1W2ReadinessChecks(): StabilizationReadinessCheck[] {
  return [...W1_W2_CHECKS];
}

export function buildStabilizationReadiness(
  input: Partial<StabilizationReadinessInput> = {},
): StabilizationReadinessSummary {
  const passedKeys = new Set(input.passedKeys ?? []);
  const checks = W1_W2_CHECKS.map((check) => ({
    ...check,
    passed: passedKeys.has(check.key),
  }));
  const remaining = checks.filter((check) => !check.passed);
  const roleEntries = MODE_MATRIX.filter((entry) => entry.role === "operator" || entry.role === "security")
    .map((entry) => ({
      role: entry.role,
      dashboardPath: entry.dashboardPath,
      successScenario: entry.successScenario,
    }));

  return {
    status: remaining.length === 0 ? "ready" : "in_progress",
    total: checks.length,
    passed: checks.length - remaining.length,
    remaining,
    checks,
    roleEntries,
    blockedUnsafeActions: [...UNSAFE_ACTIONS],
  };
}
