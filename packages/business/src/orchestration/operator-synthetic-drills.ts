import type { AuthContext } from "@sangfor/auth";

export type DrillScenario = "stuck-approval" | "missing-rls-context" | "ai-cost-spike";
export type DrillPhase = "detected_metric" | "alert_opened" | "remediation_requested" | "recovery_verified" | "evidence_sealed" | "fixture_cleaned";

export interface DrillRunPhase {
  phase: DrillPhase;
  timestamp: string | null;
  status: "SUCCESS" | "FAILED" | "PENDING";
  details?: string;
  evidenceId?: string;
}

export interface DrillRunResult {
  runId: string | null;
  scenario: DrillScenario;
  scope: { companyId: string; projectId: string };
  status: "SUCCESS" | "FAILED";
  phases: DrillRunPhase[];
  startedAt: string | null;
  completedAt: string | null;
}

export type ExecuteDrillPhase = (input: {
  phase: DrillPhase;
  scenario: DrillScenario;
  authContext: AuthContext;
  idempotencyKey: string;
}) => Promise<Omit<DrillRunPhase, "phase">>;

const DRILL_PHASES: DrillPhase[] = [
  "detected_metric",
  "alert_opened",
  "remediation_requested",
  "recovery_verified",
  "evidence_sealed",
  "fixture_cleaned",
];

export function isDrillScenario(value: unknown): value is DrillScenario {
  return value === "stuck-approval" || value === "missing-rls-context" || value === "ai-cost-spike";
}

export async function runSyntheticRemediationDrill(input: {
  scenario: DrillScenario;
  authContext: AuthContext;
  idempotencyKey: string;
  runId?: string;
  executePhase?: ExecuteDrillPhase;
}): Promise<DrillRunResult> {
  const { scenario, authContext } = input;
  if (!input.executePhase) {
    return {
      runId: null,
      scenario,
      scope: { companyId: authContext.companyId, projectId: authContext.projectId },
      status: "FAILED",
      phases: DRILL_PHASES.map((phase) => ({ phase, timestamp: null, status: "PENDING", details: "drill_evidence_adapter_not_configured" })),
      startedAt: null,
      completedAt: null,
    };
  }

  const phases: DrillRunPhase[] = [];
  for (const phase of DRILL_PHASES) {
    const evidence = await input.executePhase({ phase, scenario, authContext, idempotencyKey: input.idempotencyKey });
    phases.push({ phase, ...evidence });
    if (evidence.status !== "SUCCESS") break;
  }
  const timestamps = phases.flatMap((phase) => phase.timestamp ? [phase.timestamp] : []);
  const successful = phases.length === DRILL_PHASES.length && phases.every((phase) => phase.status === "SUCCESS");

  return {
    runId: input.runId ?? null,
    scenario,
    scope: { companyId: authContext.companyId, projectId: authContext.projectId },
    status: successful ? "SUCCESS" : "FAILED",
    phases,
    startedAt: timestamps[0] ?? null,
    completedAt: successful ? timestamps.at(-1) ?? null : null,
  };
}
