import { prisma, type Prisma } from "@sangfor/db";

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
