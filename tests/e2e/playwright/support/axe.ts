/**
 * U066 — axe-core accessibility helper
 *
 * Wraps @axe-core/playwright for critical=0, serious=0 enforcement.
 * No rule disable/exclude allowed.
 */

import type { Page } from "@playwright/test";

export type AxeResult = {
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  violations: { id: string; impact: string; description: string; nodes: number }[];
};

export async function runAxeAudit(page: Page): Promise<AxeResult> {
  const { default: AxeBuilder } = await import("@axe-core/playwright");
  const results = await new AxeBuilder({ page }).analyze();

  const violations = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact ?? "unknown",
    description: v.description,
    nodes: v.nodes.length,
  }));

  return {
    critical: violations.filter((v) => v.impact === "critical").length,
    serious: violations.filter((v) => v.impact === "serious").length,
    moderate: violations.filter((v) => v.impact === "moderate").length,
    minor: violations.filter((v) => v.impact === "minor").length,
    violations,
  };
}

export function assertAxeClean(result: AxeResult): void {
  if (result.critical > 0) {
    throw new Error(`axe critical violations: ${result.critical} — ${JSON.stringify(result.violations.filter((v) => v.impact === "critical"))}`);
  }
  if (result.serious > 0) {
    throw new Error(`axe serious violations: ${result.serious} — ${JSON.stringify(result.violations.filter((v) => v.impact === "serious"))}`);
  }
}
