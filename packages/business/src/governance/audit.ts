import { Prisma, prisma } from "@sangfor/db";

import { appendAuditEvent, type AppendedAuditEvent } from "./audit-db";
import type { AuditChainScope } from "./audit-chain";

/**
 * Purpose: Record entity status changes in audit.state_transition_logs.
 * Failure Points: Missing actor metadata on automated transitions.
 * Observability: audit.state_transition_logs
 */
export async function logStateTransition(input: {
  entityType: string;
  entityId: string;
  fromStatus?: string | null;
  toStatus: string;
  actorType?: string;
  actorId?: string;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.stateTransitionLog.create({ data: input });
}

/**
 * U021/AUD-01b: the atomic domain-mutation + audit-append pattern the hardened chain requires
 * (contract point 2) — a representative domain service (the state-transition log) and its own
 * audit event committed/rolled back together in ONE Prisma transaction, via `appendAuditEvent`'s
 * transaction-client parameter. Callers that already hold a `Prisma.TransactionClient` may pass it
 * directly (via `tx`); the default (`prisma.$transaction`) opens one for a standalone call.
 */
export async function logStateTransitionWithAudit(
  input: {
    entityType: string;
    entityId: string;
    fromStatus?: string | null;
    toStatus: string;
    actorType?: string;
    actorId?: string;
    metadata?: Prisma.InputJsonValue;
  },
  audit: {
    scope: AuditChainScope;
    eventType?: string;
    resourceId?: string;
    idempotencyKey?: string | null;
  },
  tx?: Prisma.TransactionClient,
): Promise<{ stateTransitionId: string; audit: AppendedAuditEvent }> {
  const run = async (client: Prisma.TransactionClient) => {
    const stateTransition = await client.stateTransitionLog.create({ data: input });
    const auditEvent = await appendAuditEvent(client, {
      scope: audit.scope,
      eventType: audit.eventType ?? `${input.entityType}.state_transition`,
      actorId: input.actorId ?? null,
      resourceType: input.entityType,
      resourceId: audit.resourceId ?? input.entityId,
      details: { fromStatus: input.fromStatus ?? null, toStatus: input.toStatus },
      idempotencyKey: audit.idempotencyKey ?? null,
    });
    return { stateTransitionId: stateTransition.id, audit: auditEvent };
  };

  if (tx) return run(tx);
  return prisma.$transaction((client) => run(client));
}

export async function enqueueOutboxEvent(input: {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.InputJsonValue;
}) {
  return prisma.outboxEvent.create({
    data: { ...input, status: "pending" },
  });
}

export async function processPendingOutboxEvents(limit = 20) {
  const events = await prisma.outboxEvent.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  for (const event of events) {
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: { status: "processed", processedAt: new Date() },
    });
  }

  return events.length;
}
