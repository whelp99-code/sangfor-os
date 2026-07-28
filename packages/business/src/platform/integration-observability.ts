import type { AuthContext } from "@sangfor/auth";
import { withRlsTransaction } from "@sangfor/db";
import { appendAuditEvent } from "../governance/audit-db";

export class IntegrationObservabilityError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "IntegrationObservabilityError";
    this.code = code;
    this.httpStatus = status;
  }
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

export type ObservationState = "healthy" | "degraded" | "unreachable" | "unknown";

export interface IntegrationObservation {
  targetId: string;
  state: ObservationState;
  observedAt: string | null;
  latencyMs: number | null;
  errorCode: string | null;
}

interface IntegrationTarget {
  targetId: string;
  name: string;
}

const INTEGRATION_TARGETS: IntegrationTarget[] = [
  { targetId: "postgres-primary", name: "Primary PostgreSQL" },
  { targetId: "redis-cache", name: "Redis Cache" },
  { targetId: "mail-service", name: "Mail Intelligence Connector" },
];

type ProbeTarget = (targetId: string) => Promise<Omit<IntegrationObservation, "targetId" | "observedAt"> & { observedAt?: string }>;

function readObservation(details: unknown, fallbackObservedAt: Date): IntegrationObservation | null {
  if (!details || typeof details !== "object" || Array.isArray(details)) return null;
  const value = details as Record<string, unknown>;
  if (typeof value.targetId !== "string") return null;
  const state = value.state;
  if (state !== "healthy" && state !== "degraded" && state !== "unreachable" && state !== "unknown") return null;
  return {
    targetId: value.targetId,
    state,
    observedAt: typeof value.observedAt === "string" ? value.observedAt : fallbackObservedAt.toISOString(),
    latencyMs: typeof value.latencyMs === "number" ? value.latencyMs : null,
    errorCode: typeof value.errorCode === "string" ? value.errorCode : null,
  };
}

function overallState(observations: IntegrationObservation[]): ObservationState {
  if (observations.some((item) => item.state === "unreachable")) return "unreachable";
  if (observations.some((item) => item.state === "degraded")) return "degraded";
  if (observations.length > 0 && observations.every((item) => item.state === "healthy")) return "healthy";
  return "unknown";
}

export interface GetIntegrationHealthInput {
  authContext: AuthContext;
}

export async function getIntegrationHealth(input: GetIntegrationHealthInput) {
  const scope = rlsScope(input.authContext);

  return withRlsTransaction(scope, async (tx) => {
    const rows = await tx.auditLog.findMany({
      where: {
        eventType: "integration.observation.recorded",
        resourceType: "integration_target",
        resourceId: { in: INTEGRATION_TARGETS.map((target) => target.targetId) },
      },
      orderBy: { timestamp: "desc" },
      select: { resourceId: true, details: true, timestamp: true },
    });
    const latest = new Map<string, IntegrationObservation>();
    for (const row of rows) {
      if (!row.resourceId || latest.has(row.resourceId)) continue;
      const observation = readObservation(row.details, row.timestamp);
      if (observation) latest.set(row.resourceId, observation);
    }

    const targets = INTEGRATION_TARGETS.map((target) => ({
      ...target,
      ...(latest.get(target.targetId) ?? {
        targetId: target.targetId,
        state: "unknown" as const,
        observedAt: null,
        latencyMs: null,
        errorCode: "no_persisted_observation",
      }),
    }));
    const observedTimes = targets.flatMap((target) => target.observedAt ? [target.observedAt] : []);

    return {
      asOf: observedTimes.sort().at(-1) ?? null,
      targets,
      overallState: overallState(targets),
    };
  });
}

export interface ReprobeTargetInput {
  authContext: AuthContext;
  targetId: string;
  idempotencyKey: string;
  probeTarget?: ProbeTarget;
}

export async function reprobeTarget(input: ReprobeTargetInput) {
  const { authContext, targetId, idempotencyKey } = input;
  if (!INTEGRATION_TARGETS.some((target) => target.targetId === targetId)) {
    throw new IntegrationObservabilityError("target_not_registered", `Unknown integration target: ${targetId}`, 404);
  }

  const measured = input.probeTarget
    ? await input.probeTarget(targetId).catch(() => ({ state: "unreachable" as const, latencyMs: null, errorCode: "probe_failed" }))
    : { state: "unknown" as const, latencyMs: null, errorCode: "probe_not_configured" };
  const observedAt = "observedAt" in measured && measured.observedAt ? measured.observedAt : new Date().toISOString();
  const scope = rlsScope(authContext);

  return withRlsTransaction(scope, async (tx) => {
    const existing = await tx.auditLog.findFirst({
      where: { idempotencyKey },
      select: { id: true, eventType: true, resourceType: true, resourceId: true, details: true, timestamp: true },
    });
    if (existing) {
      if (existing.eventType !== "integration.observation.recorded" || existing.resourceType !== "integration_target" || existing.resourceId !== targetId) {
        throw new IntegrationObservabilityError("idempotency_key_conflict", "Idempotency key was already used for a different operation", 409);
      }
      const observation = readObservation(existing.details, existing.timestamp);
      if (!observation) throw new IntegrationObservabilityError("invalid_persisted_observation", "Persisted observation evidence is invalid", 500);
      return { ...observation, auditLogId: existing.id };
    }

    const details = { targetId, state: measured.state, latencyMs: measured.latencyMs, errorCode: measured.errorCode, observedAt };
    const audit = await appendAuditEvent(tx, {
      scope,
      eventType: "integration.observation.recorded",
      actorId: authContext.userId,
      resourceType: "integration_target",
      resourceId: targetId,
      details,
      idempotencyKey,
    });

    return { ...details, auditLogId: audit.id };
  });
}

export interface AcknowledgeObservationInput {
  authContext: AuthContext;
  targetId: string;
  observationId: string;
  idempotencyKey: string;
}

export async function acknowledgeObservation(input: AcknowledgeObservationInput) {
  const { authContext, targetId, observationId, idempotencyKey } = input;
  const scope = rlsScope(authContext);

  return withRlsTransaction(scope, async (tx) => {
    const existingAcknowledgement = await tx.auditLog.findFirst({
      where: { idempotencyKey },
      select: { id: true, eventType: true, resourceId: true, details: true, timestamp: true },
    });
    if (existingAcknowledgement) {
      if (existingAcknowledgement.eventType !== "integration.observation.acknowledged" || existingAcknowledgement.resourceId !== observationId) {
        throw new IntegrationObservabilityError("idempotency_key_conflict", "Idempotency key was already used for a different operation", 409);
      }
      const details = existingAcknowledgement.details && typeof existingAcknowledgement.details === "object" && !Array.isArray(existingAcknowledgement.details)
        ? existingAcknowledgement.details as Record<string, unknown>
        : {};
      return {
        targetId,
        observationId,
        acknowledgedAt: typeof details.acknowledgedAt === "string" ? details.acknowledgedAt : existingAcknowledgement.timestamp.toISOString(),
        auditLogId: existingAcknowledgement.id,
      };
    }

    const observation = await tx.auditLog.findFirst({
      where: { id: observationId, eventType: "integration.observation.recorded", resourceType: "integration_target", resourceId: targetId },
      select: { id: true },
    });
    if (!observation) throw new IntegrationObservabilityError("observation_not_found", "Persisted observation was not found", 404);

    const acknowledgedAt = new Date().toISOString();
    const audit = await appendAuditEvent(tx, {
      scope,
      eventType: "integration.observation.acknowledged",
      actorId: authContext.userId,
      resourceType: "integration_observation",
      resourceId: observationId,
      details: { targetId, observationId, acknowledgedAt },
      idempotencyKey,
    });

    return { targetId, observationId, acknowledgedAt, auditLogId: audit.id };
  });
}
