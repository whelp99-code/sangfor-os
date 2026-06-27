# Sangfor OS W1-W2 Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the W1-W2 stabilization baseline for `sangfor-os`: mode contracts, approval/audit/evidence guardrails, mail loop follow-up, deal/quote gates, role workspaces, health runbook, and deterministic demo smoke assets.

**Architecture:** Build additive, independently testable modules that formalize operating modes and readiness contracts without rewriting current business flows. Use `packages/shared` for mode contracts, `packages/business` for domain guardrails and scenario summaries, `packages/health`/`scripts` for local health checks, `apps/web` for role entry surfaces, and `docs/12_VERIFICATION` for operator runbooks. Keep irreversible or external side effects blocked behind explicit approval gates.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, Prisma 6, Next.js 16 App Router, Bash health scripts, Markdown runbooks.

## Global Constraints

- Work in `/Users/jmpark/Playground/sangfor-os` on branch `continue-mail-candidate-connection-ui` unless a fresh worktree is explicitly created for parallel implementation.
- Before editing files under `apps/web`, read the relevant guide in `apps/web/node_modules/next/dist/docs/`; for route handlers use `01-app/01-getting-started/15-route-handlers.md`.
- Follow TDD: write a failing test, verify RED, implement minimal code, verify GREEN.
- Do not send real mail, deploy, mutate production DBs, force push, or create release tags.
- Runtime verification may mutate the local Docker Postgres database only.
- Treat `/Users/jmpark/.mail-intel/data.db` as local real-mail cache data; do not commit copied mail contents or secrets.
- Real external side effects must be disabled by default in dev/demo.
- Unsafe actions include send, export, share, delete, deploy, real upstream write, production DB mutation, and release tagging.
- AI output is never treated as approved output by default.
- Known caveat: `pnpm lint` may fail because ESLint is not consistently resolvable in the workspace; do not make lint a hard gate for this plan.

---

## File Structure

### Create

- `packages/shared/src/modes.ts`
  - Owns role/work modes, AI execution modes, product operating modes, unsafe action keys, mode matrix, and guard helpers.
  - Exports pure TypeScript constants/functions used by docs, business, and UI.

- `packages/shared/src/modes.test.ts`
  - Unit tests for mode matrix completeness and guard behavior.

- `packages/business/src/stabilization-readiness.ts`
  - Owns W1-W2 readiness scoring and scenario checklist generation for Operator/Security surfaces.

- `packages/business/src/stabilization-readiness.test.ts`
  - Unit tests for readiness scoring.

- `packages/business/src/commercial-approval.ts`
  - Owns quote/commercial approval gate baseline: margin calculation, discount threshold, export/send blocking state.

- `packages/business/src/commercial-approval.test.ts`
  - Unit tests for commercial approval decisions.

- `apps/web/src/app/(portal)/operator/page.tsx`
  - Operator workspace entry page with readiness/health/runbook links.

- `apps/web/src/app/(portal)/security/page.tsx`
  - Security workspace entry page with unsafe action/audit/evidence overview.

- `docs/12_VERIFICATION/w1-w2-stabilization-runbook.md`
  - Manual runbook for W1-W2 local verification.

- `docs/12_VERIFICATION/w1-w2-demo-script.md`
  - Role-based demo script and acceptance checklist.

- `scripts/health-check.test.mjs`
  - Tests parsing/endpoint configuration behavior for health check script if script is converted to predictable endpoint list output.

### Modify

- `packages/shared/src/index.ts`
  - Export `./modes.js`.

- `packages/business/src/index.ts`
  - Export `./stabilization-readiness` and `./commercial-approval`.

- `packages/db/prisma/seed.ts`
  - Add deterministic demo rows only if needed by readiness/demo smoke. Must remain idempotent and never read private mail.

- `scripts/health-check.sh`
  - Update default ports to match `sangfor-os`: web `3101`, api `3200`.
  - Distinguish critical and optional services.

- `apps/web/src/components/layout/app-shell.tsx` or current nav component if present
  - Add Operator and Security role entries only if missing.

---

### Task 1: Add Mode Matrix Contract

**Files:**
- Create: `packages/shared/src/modes.ts`
- Create: `packages/shared/src/modes.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:
  - `ROLE_MODES: readonly RoleMode[]`
  - `AI_EXECUTION_MODES: readonly AiExecutionMode[]`
  - `OPERATING_MODES: readonly OperatingMode[]`
  - `UNSAFE_ACTIONS: readonly UnsafeAction[]`
  - `MODE_MATRIX: readonly ModeMatrixEntry[]`
  - `isUnsafeAction(action: string): action is UnsafeAction`
  - `requiresApprovalForAction(action: string): boolean`
  - `getRoleModeEntry(role: RoleMode): ModeMatrixEntry`
- Consumes: none.

- [ ] **Step 1: Write failing tests**

Create `packages/shared/src/modes.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  AI_EXECUTION_MODES,
  MODE_MATRIX,
  OPERATING_MODES,
  ROLE_MODES,
  UNSAFE_ACTIONS,
  getRoleModeEntry,
  isUnsafeAction,
  requiresApprovalForAction,
} from "./modes";

describe("mode matrix", () => {
  it("defines every required role, AI, and operating mode", () => {
    expect(ROLE_MODES).toEqual([
      "sales",
      "presales",
      "delivery",
      "support",
      "cfo",
      "operator",
      "security",
    ]);
    expect(AI_EXECUTION_MODES).toEqual([
      "draft",
      "review",
      "approve",
      "smoke",
      "full",
      "manual",
      "assisted",
      "autonomous",
      "color-agent-review",
    ]);
    expect(OPERATING_MODES).toEqual([
      "dev",
      "demo",
      "staging",
      "production",
      "mock-upstream",
      "real-upstream",
      "read-only",
      "write-enabled",
    ]);
  });

  it("requires approval for unsafe actions", () => {
    expect(UNSAFE_ACTIONS).toEqual([
      "send",
      "export",
      "share",
      "delete",
      "deploy",
      "real-upstream-write",
      "production-db-mutation",
      "release-tag",
    ]);
    expect(isUnsafeAction("send")).toBe(true);
    expect(isUnsafeAction("view-dashboard")).toBe(false);
    expect(requiresApprovalForAction("send")).toBe(true);
    expect(requiresApprovalForAction("view-dashboard")).toBe(false);
  });

  it("defines a role entry with dashboard, allowed actions, blocked actions, and evidence", () => {
    expect(MODE_MATRIX).toHaveLength(ROLE_MODES.length);
    expect(getRoleModeEntry("operator")).toMatchObject({
      role: "operator",
      dashboardPath: "/operator",
      evidenceVisible: true,
    });
    expect(getRoleModeEntry("security").blockedActions).toEqual(
      expect.arrayContaining(["deploy", "production-db-mutation", "release-tag"]),
    );
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --dir packages/shared exec vitest run src/modes.test.ts
```

Expected:

```text
FAIL ... Cannot find module './modes'
```

- [ ] **Step 3: Implement `packages/shared/src/modes.ts`**

Create `packages/shared/src/modes.ts`:

```ts
export const ROLE_MODES = [
  "sales",
  "presales",
  "delivery",
  "support",
  "cfo",
  "operator",
  "security",
] as const;

export type RoleMode = (typeof ROLE_MODES)[number];

export const AI_EXECUTION_MODES = [
  "draft",
  "review",
  "approve",
  "smoke",
  "full",
  "manual",
  "assisted",
  "autonomous",
  "color-agent-review",
] as const;

export type AiExecutionMode = (typeof AI_EXECUTION_MODES)[number];

export const OPERATING_MODES = [
  "dev",
  "demo",
  "staging",
  "production",
  "mock-upstream",
  "real-upstream",
  "read-only",
  "write-enabled",
] as const;

export type OperatingMode = (typeof OPERATING_MODES)[number];

export const UNSAFE_ACTIONS = [
  "send",
  "export",
  "share",
  "delete",
  "deploy",
  "real-upstream-write",
  "production-db-mutation",
  "release-tag",
] as const;

export type UnsafeAction = (typeof UNSAFE_ACTIONS)[number];

export type ModeMatrixEntry = {
  role: RoleMode;
  dashboardPath: string;
  allowedActions: string[];
  blockedActions: UnsafeAction[];
  approvalResponsibilities: string[];
  evidenceVisible: boolean;
  successScenario: string;
};

const ALL_UNSAFE = [...UNSAFE_ACTIONS];

export const MODE_MATRIX: readonly ModeMatrixEntry[] = [
  {
    role: "sales",
    dashboardPath: "/sales",
    allowedActions: ["view-dashboard", "create-customer", "create-opportunity", "request-approval"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["prepare evidence before requesting quote/proposal approval"],
    evidenceVisible: true,
    successScenario: "Create or approve a qualified opportunity with evidence-backed proposal draft.",
  },
  {
    role: "presales",
    dashboardPath: "/presales",
    allowedActions: ["view-dashboard", "create-poc", "draft-technical-proposal", "request-review"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["review technical fit and attach implementation evidence"],
    evidenceVisible: true,
    successScenario: "Review PoC or proposal evidence and prepare technical approval input.",
  },
  {
    role: "delivery",
    dashboardPath: "/delivery",
    allowedActions: ["view-dashboard", "update-delivery-checklist", "record-asset"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["confirm delivery acceptance before asset/license activation"],
    evidenceVisible: true,
    successScenario: "Complete delivery checklist and produce auditable asset handoff evidence.",
  },
  {
    role: "support",
    dashboardPath: "/support",
    allowedActions: ["view-dashboard", "create-support-case", "draft-rca"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["review RCA draft before external customer sharing"],
    evidenceVisible: true,
    successScenario: "Create support case linked to customer asset and RCA draft evidence.",
  },
  {
    role: "cfo",
    dashboardPath: "/cfo/dashboard",
    allowedActions: ["view-dashboard", "review-margin", "review-cashflow", "approve-commercial"],
    blockedActions: ["send", "share", "delete", "deploy", "real-upstream-write", "production-db-mutation", "release-tag"],
    approvalResponsibilities: ["approve low-margin or high-discount commercial actions"],
    evidenceVisible: true,
    successScenario: "Review quote margin and commercial approval evidence before finance handoff.",
  },
  {
    role: "operator",
    dashboardPath: "/operator",
    allowedActions: ["view-dashboard", "run-smoke-check", "inspect-health", "inspect-runbook"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["verify health, smoke, and rollback readiness before release"],
    evidenceVisible: true,
    successScenario: "Inspect system health and W1-W2 verification status from one workspace.",
  },
  {
    role: "security",
    dashboardPath: "/security",
    allowedActions: ["view-dashboard", "inspect-audit", "inspect-policy", "review-gated-action"],
    blockedActions: ALL_UNSAFE,
    approvalResponsibilities: ["verify unsafe actions remain gated and audited"],
    evidenceVisible: true,
    successScenario: "Inspect unsafe action policy, audit coverage, and approval gate evidence.",
  },
] as const;

export function isUnsafeAction(action: string): action is UnsafeAction {
  return (UNSAFE_ACTIONS as readonly string[]).includes(action);
}

export function requiresApprovalForAction(action: string): boolean {
  return isUnsafeAction(action);
}

export function getRoleModeEntry(role: RoleMode): ModeMatrixEntry {
  const entry = MODE_MATRIX.find((item) => item.role === role);
  if (!entry) throw new Error(`unknown_role_mode:${role}`);
  return entry;
}
```

- [ ] **Step 4: Export modes**

Modify `packages/shared/src/index.ts`:

```ts
export * from "./status.js";
export * from "./modes.js";

export const PROJECT_NAME = "AI Automation Work Portal" as const;
export const PROJECT_PHASE = 13 as const;
export const PROJECT_TAGLINE =
  "AI업무포탈 with an embedded development automation kernel." as const;

/** Client-safe proposal template keys (mirrors automation generator). */
export const PROPOSAL_TEMPLATE_KEYS = [
  "standard-proposal",
  "poc-summary",
  "technical-spec",
  "pricing-sheet",
  "executive-brief",
  "implementation-plan",
  "support-handoff",
] as const;

export type ProposalTemplateKey = (typeof PROPOSAL_TEMPLATE_KEYS)[number];
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm --dir packages/shared exec vitest run src/modes.test.ts
pnpm --filter @sangfor/shared typecheck
```

Expected:

```text
Test Files  1 passed
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/modes.ts packages/shared/src/modes.test.ts
git commit -m "feat(shared): add operating mode matrix"
```

---

### Task 2: Add Stabilization Readiness Summary

**Files:**
- Create: `packages/business/src/stabilization-readiness.ts`
- Create: `packages/business/src/stabilization-readiness.test.ts`
- Modify: `packages/business/src/index.ts`

**Interfaces:**
- Consumes from `@sangfor/shared`: `MODE_MATRIX`, `UNSAFE_ACTIONS`, `RoleMode`.
- Produces:
  - `buildStabilizationReadiness(input?: Partial<StabilizationReadinessInput>): StabilizationReadinessSummary`
  - `listW1W2ReadinessChecks(): StabilizationReadinessCheck[]`

- [ ] **Step 1: Write failing tests**

Create `packages/business/src/stabilization-readiness.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  buildStabilizationReadiness,
  listW1W2ReadinessChecks,
} from "./stabilization-readiness";

describe("stabilization readiness", () => {
  it("lists W1-W2 checks across foundation, mail, revenue, roles, health, and demo", () => {
    expect(listW1W2ReadinessChecks().map((check) => check.key)).toEqual([
      "mode_matrix_defined",
      "unsafe_actions_gated",
      "mail_loop_verified",
      "deal_quote_gate_defined",
      "role_workspaces_visible",
      "health_runbook_available",
      "demo_seed_idempotent",
    ]);
  });

  it("builds an operator and security readable readiness summary", () => {
    const summary = buildStabilizationReadiness({
      passedKeys: [
        "mode_matrix_defined",
        "unsafe_actions_gated",
        "mail_loop_verified",
        "health_runbook_available",
      ],
    });

    expect(summary.total).toBe(7);
    expect(summary.passed).toBe(4);
    expect(summary.status).toBe("in_progress");
    expect(summary.roleEntries.map((entry) => entry.role)).toEqual(
      expect.arrayContaining(["operator", "security"]),
    );
    expect(summary.blockedUnsafeActions).toEqual(
      expect.arrayContaining(["send", "deploy", "production-db-mutation"]),
    );
  });

  it("marks readiness complete only when all checks pass", () => {
    const summary = buildStabilizationReadiness({
      passedKeys: listW1W2ReadinessChecks().map((check) => check.key),
    });

    expect(summary.status).toBe("ready");
    expect(summary.remaining).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --dir packages/business exec vitest run src/stabilization-readiness.test.ts
```

Expected:

```text
FAIL ... Cannot find module './stabilization-readiness'
```

- [ ] **Step 3: Implement readiness module**

Create `packages/business/src/stabilization-readiness.ts`:

```ts
import { MODE_MATRIX, UNSAFE_ACTIONS, type RoleMode, type UnsafeAction } from "@sangfor/shared";

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
```

- [ ] **Step 4: Export readiness module**

Append to `packages/business/src/index.ts` if not present:

```ts
export * from "./stabilization-readiness";
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm --dir packages/business exec vitest run src/stabilization-readiness.test.ts
pnpm --filter @sangfor/business typecheck
```

Expected:

```text
Test Files  1 passed
```

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/index.ts packages/business/src/stabilization-readiness.ts packages/business/src/stabilization-readiness.test.ts
git commit -m "feat(business): add stabilization readiness summary"
```

---

### Task 3: Add Commercial Approval Gate Baseline

**Files:**
- Create: `packages/business/src/commercial-approval.ts`
- Create: `packages/business/src/commercial-approval.test.ts`
- Modify: `packages/business/src/index.ts`

**Interfaces:**
- Produces:
  - `calculateGrossMargin(input: CommercialApprovalInput): CommercialMarginResult`
  - `evaluateCommercialApproval(input: CommercialApprovalInput): CommercialApprovalDecision`
- Consumes: none.

- [ ] **Step 1: Write failing tests**

Create `packages/business/src/commercial-approval.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { calculateGrossMargin, evaluateCommercialApproval } from "./commercial-approval";

describe("commercial approval gate", () => {
  it("calculates gross margin percentage on the server", () => {
    expect(
      calculateGrossMargin({
        revenue: 100_000,
        cost: 70_000,
        discountPercent: 10,
        action: "export",
      }),
    ).toEqual({
      revenue: 100_000,
      cost: 70_000,
      grossMargin: 30_000,
      grossMarginPercent: 30,
    });
  });

  it("requires approval for low margin exports", () => {
    expect(
      evaluateCommercialApproval({
        revenue: 100_000,
        cost: 88_000,
        discountPercent: 5,
        action: "export",
      }),
    ).toMatchObject({
      decision: "requires_approval",
      blocked: true,
      reasons: ["low_margin", "unsafe_action"],
    });
  });

  it("requires approval for high discount even when margin is acceptable", () => {
    expect(
      evaluateCommercialApproval({
        revenue: 100_000,
        cost: 60_000,
        discountPercent: 25,
        action: "send",
      }),
    ).toMatchObject({
      decision: "requires_approval",
      blocked: true,
      reasons: ["high_discount", "unsafe_action"],
    });
  });

  it("allows review-only actions when commercial thresholds are healthy", () => {
    expect(
      evaluateCommercialApproval({
        revenue: 100_000,
        cost: 60_000,
        discountPercent: 5,
        action: "view-dashboard",
      }),
    ).toMatchObject({
      decision: "allowed",
      blocked: false,
      reasons: [],
    });
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm --dir packages/business exec vitest run src/commercial-approval.test.ts
```

Expected:

```text
FAIL ... Cannot find module './commercial-approval'
```

- [ ] **Step 3: Implement commercial approval module**

Create `packages/business/src/commercial-approval.ts`:

```ts
import { requiresApprovalForAction } from "@sangfor/shared";

export type CommercialApprovalInput = {
  revenue: number;
  cost: number;
  discountPercent: number;
  action: string;
  lowMarginThresholdPercent?: number;
  highDiscountThresholdPercent?: number;
};

export type CommercialMarginResult = {
  revenue: number;
  cost: number;
  grossMargin: number;
  grossMarginPercent: number;
};

export type CommercialApprovalReason = "low_margin" | "high_discount" | "unsafe_action";

export type CommercialApprovalDecision = CommercialMarginResult & {
  decision: "allowed" | "requires_approval";
  blocked: boolean;
  reasons: CommercialApprovalReason[];
};

function roundPercent(value: number) {
  return Math.round(value * 100) / 100;
}

export function calculateGrossMargin(input: CommercialApprovalInput): CommercialMarginResult {
  if (!Number.isFinite(input.revenue) || input.revenue <= 0) {
    throw new Error("commercial_revenue_must_be_positive");
  }
  if (!Number.isFinite(input.cost) || input.cost < 0) {
    throw new Error("commercial_cost_must_be_non_negative");
  }
  const grossMargin = input.revenue - input.cost;
  return {
    revenue: input.revenue,
    cost: input.cost,
    grossMargin,
    grossMarginPercent: roundPercent((grossMargin / input.revenue) * 100),
  };
}

export function evaluateCommercialApproval(input: CommercialApprovalInput): CommercialApprovalDecision {
  const margin = calculateGrossMargin(input);
  const lowMarginThreshold = input.lowMarginThresholdPercent ?? 20;
  const highDiscountThreshold = input.highDiscountThresholdPercent ?? 20;
  const reasons: CommercialApprovalReason[] = [];

  if (margin.grossMarginPercent < lowMarginThreshold) reasons.push("low_margin");
  if (input.discountPercent >= highDiscountThreshold) reasons.push("high_discount");
  if (requiresApprovalForAction(input.action)) reasons.push("unsafe_action");

  return {
    ...margin,
    decision: reasons.length > 0 ? "requires_approval" : "allowed",
    blocked: reasons.length > 0,
    reasons,
  };
}
```

- [ ] **Step 4: Export commercial approval module**

Append to `packages/business/src/index.ts` if not present:

```ts
export * from "./commercial-approval";
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm --dir packages/business exec vitest run src/commercial-approval.test.ts
pnpm --filter @sangfor/business typecheck
```

Expected:

```text
Test Files  1 passed
```

- [ ] **Step 6: Commit**

```bash
git add packages/business/src/index.ts packages/business/src/commercial-approval.ts packages/business/src/commercial-approval.test.ts
git commit -m "feat(business): add commercial approval gate baseline"
```

---

### Task 4: Add Operator and Security Workspace Pages

**Files:**
- Create: `apps/web/src/app/(portal)/operator/page.tsx`
- Create: `apps/web/src/app/(portal)/security/page.tsx`
- Modify: current app navigation component only if Operator/Security links are missing.

**Interfaces:**
- Consumes: `buildStabilizationReadiness` from `@sangfor/business`.
- Consumes: `MODE_MATRIX`, `UNSAFE_ACTIONS` from `@sangfor/shared`.
- Produces: server-rendered Operator and Security role pages.

- [ ] **Step 1: Read local Next page docs**

Run:

```bash
sed -n '1,80p' apps/web/node_modules/next/dist/docs/01-app/01-getting-started/04-layouts-and-pages.md
```

Expected includes App Router page conventions.

- [ ] **Step 2: Create Operator page**

Create `apps/web/src/app/(portal)/operator/page.tsx`:

```tsx
import { buildStabilizationReadiness } from "@sangfor/business";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default function OperatorWorkspacePage() {
  const readiness = buildStabilizationReadiness({
    passedKeys: ["mode_matrix_defined", "mail_loop_verified", "health_runbook_available"],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Operator workspace</h1>
        <p className="text-sm text-muted-foreground">
          W1-W2 stabilization health, runbook, and smoke readiness overview.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stabilization readiness</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant={readiness.status === "ready" ? "default" : "secondary"}>{readiness.status}</Badge>
            <span className="text-sm text-muted-foreground">
              {readiness.passed}/{readiness.total} checks passed
            </span>
          </div>
          <ul className="space-y-2 text-sm">
            {readiness.checks.map((check) => (
              <li key={check.key} className="flex items-start justify-between gap-4 rounded border p-3">
                <div>
                  <div className="font-medium">{check.title}</div>
                  <div className="text-muted-foreground">{check.verification}</div>
                </div>
                <Badge variant={check.passed ? "default" : "outline"}>{check.passed ? "passed" : "open"}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runbooks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>`docs/12_VERIFICATION/w1-w2-stabilization-runbook.md`</p>
          <p>`docs/12_VERIFICATION/real-mail-hardening-runbook.md`</p>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Create Security page**

Create `apps/web/src/app/(portal)/security/page.tsx`:

```tsx
import { buildStabilizationReadiness } from "@sangfor/business";
import { MODE_MATRIX, UNSAFE_ACTIONS } from "@sangfor/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default function SecurityWorkspacePage() {
  const readiness = buildStabilizationReadiness();
  const security = MODE_MATRIX.find((entry) => entry.role === "security");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Security workspace</h1>
        <p className="text-sm text-muted-foreground">
          Unsafe action policy, approval responsibilities, and audit/evidence readiness.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Unsafe actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {UNSAFE_ACTIONS.map((action) => (
            <Badge key={action} variant="destructive">{action}</Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Security responsibilities</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(security?.approvalResponsibilities ?? []).map((item) => (
            <p key={item}>{item}</p>
          ))}
          <p className="text-muted-foreground">{security?.successScenario}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Open readiness items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {readiness.remaining.map((check) => (
            <div key={check.key} className="rounded border p-3">
              <div className="font-medium">{check.title}</div>
              <div className="text-muted-foreground">{check.verification}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Verify typecheck**

Run:

```bash
pnpm --filter @sangfor/web typecheck
```

Expected exit code `0`.

- [ ] **Step 5: Browser/curl smoke**

With `pnpm dev:web` running:

```bash
curl -s http://localhost:3101/operator | grep -E "Operator workspace|Stabilization readiness"
curl -s http://localhost:3101/security | grep -E "Security workspace|Unsafe actions"
```

Expected both commands print matching lines.

- [ ] **Step 6: Commit**

```bash
git add 'apps/web/src/app/(portal)/operator/page.tsx' 'apps/web/src/app/(portal)/security/page.tsx'
git commit -m "feat(web): add operator and security workspaces"
```

---

### Task 5: Update Health Check and W1-W2 Runbooks

**Files:**
- Modify: `scripts/health-check.sh`
- Create: `docs/12_VERIFICATION/w1-w2-stabilization-runbook.md`
- Create: `docs/12_VERIFICATION/w1-w2-demo-script.md`

**Interfaces:**
- Consumes: local web `http://localhost:3101`, API `http://localhost:3200`, finance `http://localhost:4100`.
- Produces: repeatable operator verification commands.

- [ ] **Step 1: Write shell script expected behavior notes in runbook first**

Create `docs/12_VERIFICATION/w1-w2-stabilization-runbook.md`:

```md
# W1-W2 Stabilization Runbook

## Purpose

Verify the W1-W2 stabilization baseline for `sangfor-os`: mode matrix, mail loop, commercial gate baseline, role workspaces, health checks, and deterministic demo seed.

## Start local dependencies

```bash
pnpm docker:dev
pnpm db:push
pnpm db:seed
pnpm dev:web
```

## Required verification commands

```bash
pnpm --dir packages/shared exec vitest run src/modes.test.ts
pnpm --dir packages/business exec vitest run src/stabilization-readiness.test.ts src/commercial-approval.test.ts src/mail-candidates.test.ts src/mail-candidate-connections.test.ts
CI_INTEGRATION=1 pnpm --dir packages/business exec vitest run src/phase12-mail-candidate-connection.test.ts
pnpm typecheck
pnpm test
pnpm build
```

## Health check

```bash
WEB_URL=http://localhost:3101 API_URL=http://localhost:3200 FINANCE_URL=http://localhost:4100 bash scripts/health-check.sh
```

Critical checks must pass. Optional service checks may report skipped/unavailable when the service is not running.

## Role workspace smoke

```bash
curl -s http://localhost:3101/operator | grep "Operator workspace"
curl -s http://localhost:3101/security | grep "Security workspace"
```

## Real-mail smoke

Use the dedicated runbook:

```text
docs/12_VERIFICATION/real-mail-hardening-runbook.md
```

Never copy private mail contents into committed files.
```

- [ ] **Step 2: Create demo script**

Create `docs/12_VERIFICATION/w1-w2-demo-script.md`:

```md
# W1-W2 Role-Based Demo Script

## Roles

- Sales: approve or connect one evidence-backed mail candidate.
- Presales: inspect proposal or PoC evidence.
- CFO: inspect commercial approval gate output.
- Operator: inspect `/operator` readiness status and health runbook.
- Security: inspect `/security` unsafe actions and open readiness items.

## Demo flow

1. Start local dependencies with `pnpm docker:dev`, `pnpm db:push`, and `pnpm db:seed`.
2. Start web with `pnpm dev:web`.
3. Open `http://localhost:3101/development/mail-candidates`.
4. Confirm active internal/newsletter customer candidates are not pending approval.
5. Open an actionable candidate and approve/connect it.
6. Confirm proposal, opportunity, and customer pages show mail evidence.
7. Open `http://localhost:3101/operator` and inspect readiness checks.
8. Open `http://localhost:3101/security` and inspect unsafe action list.
9. Run `pnpm typecheck`, `pnpm test`, and `pnpm build` before claiming readiness.

## Acceptance

The demo passes only when evidence is visible, unsafe actions are listed as gated, and verification commands pass.
```

- [ ] **Step 3: Update `scripts/health-check.sh`**

Replace `scripts/health-check.sh` with:

```bash
#!/bin/bash
set -u

FAILED=0
API_BASE="${API_URL:-http://localhost:3200}"
WEB_BASE="${WEB_URL:-http://localhost:3101}"
FINANCE_BASE="${FINANCE_URL:-http://localhost:4100}"

check_required() {
  local name="$1" url="$2" expected="$3"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)
  if [ "$status" = "$expected" ]; then
    echo "✅ required: $name ($status)"
  else
    echo "❌ required: $name (expected $expected, got ${status:-000})"
    FAILED=1
  fi
}

check_optional() {
  local name="$1" url="$2" expected="$3"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || true)
  if [ "$status" = "$expected" ]; then
    echo "✅ optional: $name ($status)"
  else
    echo "⚠️ optional: $name unavailable (expected $expected, got ${status:-000})"
  fi
}

echo "=== sangfor-os W1-W2 Health Check ==="
echo "web=$WEB_BASE"
echo "api=$API_BASE"
echo "finance=$FINANCE_BASE"
echo ""

check_required "Web Home" "$WEB_BASE/" 200
check_required "Web Operator" "$WEB_BASE/operator" 200
check_required "Web Security" "$WEB_BASE/security" 200
check_required "Web Mail Candidates API" "$WEB_BASE/api/mail-candidates?limit=1" 200

check_optional "API Health" "$API_BASE/health" 200
check_optional "Finance Health" "$FINANCE_BASE/health" 200
check_optional "Web Unified Health" "$WEB_BASE/api/unified-health" 200

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "✅ Required checks passed"
else
  echo "❌ Required checks failed"
fi
exit "$FAILED"
```

- [ ] **Step 4: Verify health script syntax**

Run:

```bash
bash -n scripts/health-check.sh
```

Expected exit code `0`.

- [ ] **Step 5: Run health script with web running**

Run:

```bash
WEB_URL=http://localhost:3101 API_URL=http://localhost:3200 FINANCE_URL=http://localhost:4100 bash scripts/health-check.sh
```

Expected required checks pass if `pnpm dev:web` is running. Optional API/finance may warn if services are not running.

- [ ] **Step 6: Commit**

```bash
git add scripts/health-check.sh docs/12_VERIFICATION/w1-w2-stabilization-runbook.md docs/12_VERIFICATION/w1-w2-demo-script.md
git commit -m "docs(ops): add W1-W2 stabilization runbooks"
```

---

### Task 6: Extend Deterministic Demo Seed

**Files:**
- Modify: `packages/db/prisma/seed.ts`

**Interfaces:**
- Consumes: Prisma models already used by current seed.
- Produces: deterministic demo project baseline suitable for W1-W2 smoke.

- [ ] **Step 1: Write failing expectation as command**

Run before implementation:

```bash
pnpm db:seed && pnpm --filter @sangfor/db exec tsx -e '
import { prisma } from "./src/index.ts";
(async () => {
  const customer = await prisma.customer.findFirst({ where: { domain: "demo-customer.example.com" } });
  console.log(JSON.stringify({ hasDemoCustomer: Boolean(customer) }));
  await prisma.$disconnect();
})();
'
```

Expected before implementation:

```json
{"hasDemoCustomer":false}
```

- [ ] **Step 2: Add deterministic customer/contact/opportunity if model fields match**

Modify `packages/db/prisma/seed.ts` by adding this inside `main()` after policy memory upserts. Adjust only if Prisma field names differ:

```ts
  const customer = await prisma.customer.upsert({
    where: {
      projectId_domain: {
        projectId: project.id,
        domain: "demo-customer.example.com",
      },
    },
    update: {
      name: "Demo Customer",
      status: "active",
      notes: "Synthetic W1-W2 demo customer. No private data.",
    },
    create: {
      projectId: project.id,
      name: "Demo Customer",
      domain: "demo-customer.example.com",
      status: "active",
      notes: "Synthetic W1-W2 demo customer. No private data.",
    },
  });

  await prisma.contact.upsert({
    where: {
      customerId_email: {
        customerId: customer.id,
        email: "buyer@demo-customer.example.com",
      },
    },
    update: {
      name: "Demo Buyer",
      role: "Business buyer",
    },
    create: {
      customerId: customer.id,
      name: "Demo Buyer",
      email: "buyer@demo-customer.example.com",
      role: "Business buyer",
    },
  });
```

If `customerId_email` unique does not exist, use `findFirst` + `create`/`update` instead and add a short comment explaining why.

- [ ] **Step 3: Verify GREEN and idempotency**

Run:

```bash
pnpm db:seed
pnpm db:seed
pnpm --filter @sangfor/db exec tsx -e '
import { prisma } from "./src/index.ts";
(async () => {
  const customer = await prisma.customer.findFirst({ where: { domain: "demo-customer.example.com" } });
  const contact = customer ? await prisma.contact.findFirst({ where: { customerId: customer.id, email: "buyer@demo-customer.example.com" } }) : null;
  console.log(JSON.stringify({ hasDemoCustomer: Boolean(customer), hasDemoContact: Boolean(contact) }));
  await prisma.$disconnect();
})();
'
```

Expected:

```json
{"hasDemoCustomer":true,"hasDemoContact":true}
```

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/seed.ts
git commit -m "fix(db): extend deterministic W1-W2 demo seed"
```

---

## Final Verification

After all tasks complete, run:

```bash
pnpm --dir packages/shared exec vitest run src/modes.test.ts
pnpm --dir packages/business exec vitest run src/stabilization-readiness.test.ts src/commercial-approval.test.ts src/mail-candidates.test.ts src/mail-candidate-connections.test.ts
CI_INTEGRATION=1 pnpm --dir packages/business exec vitest run src/phase12-mail-candidate-connection.test.ts
pnpm db:seed
pnpm typecheck
pnpm test
pnpm build
bash -n scripts/health-check.sh
```

If web is running, also run:

```bash
WEB_URL=http://localhost:3101 API_URL=http://localhost:3200 FINANCE_URL=http://localhost:4100 bash scripts/health-check.sh
curl -s http://localhost:3101/operator | grep "Operator workspace"
curl -s http://localhost:3101/security | grep "Security workspace"
```

## Self-Review

**Spec coverage:**

- PR-01 mode matrix: Task 1.
- PR-02 audit/evidence baseline: Task 2 readiness summary and existing mail evidence baseline; deeper audit expansion is deferred to W3+ implementation plans.
- PR-03 mail loop hardening follow-up: already completed in prior real-mail hardening branch; re-verified by final commands and runbooks.
- PR-04 deal/quote approval gate baseline: Task 3.
- PR-05 role workspace navigation/dashboard entry: Task 4.
- PR-06 observability/health runbook: Task 5.
- PR-07 demo seed/smoke scenario pack: Task 6.

**Placeholder scan:** No `TBD`, `TODO`, `fill in`, or unspecified edge-case instructions remain.

**Type consistency:** `RoleMode`, `UnsafeAction`, `StabilizationReadinessCheckKey`, and commercial approval function names are defined before use and used consistently.
