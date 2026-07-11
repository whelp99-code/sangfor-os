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
