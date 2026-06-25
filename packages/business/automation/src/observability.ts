import { prisma } from "@ai-portal/db";

import { buildTimeline, getCommandRunDetail } from "./command-center";

/**
 * Purpose: Persist timeline items and record errors for Beta traceability.
 * Failure Points: Timeline drift from live workflow; duplicate error events.
 * Observability: run_timeline_items, error_events, notification_events, state_transition_logs
 */
export async function syncRunTimeline(commandRunId: string) {
  const run = await getCommandRunDetail(commandRunId);
  if (!run) throw new Error("command_run_not_found");

  const items = buildTimeline(run);

  await prisma.runTimelineItem.deleteMany({ where: { commandRunId } });

  for (const [index, item] of items.entries()) {
    await prisma.runTimelineItem.create({
      data: {
        commandRunId,
        label: item.label,
        status: item.status,
        sortOrder: index,
      },
    });
  }

  return prisma.runTimelineItem.findMany({
    where: { commandRunId },
    orderBy: { sortOrder: "asc" },
  });
}

export async function recordToolFailure(
  commandRunId: string,
  toolKey: string,
  message: string,
) {
  await prisma.errorEvent.create({
    data: {
      source: `tool:${toolKey}`,
      message,
      details: { commandRunId },
    },
  });

  await prisma.notificationEvent.create({
    data: {
      commandRunId,
      eventType: "tool.failed",
      message: `${toolKey} failed: ${message}`,
    },
  });

  await syncRunTimeline(commandRunId);
}

export async function getTraceSummary(commandRunId: string) {
  const [timeline, transitions, errors, notifications] = await Promise.all([
    prisma.runTimelineItem.findMany({
      where: { commandRunId },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.stateTransitionLog.findMany({
      where: { entityId: commandRunId },
      orderBy: { createdAt: "asc" },
      take: 50,
    }),
    prisma.errorEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.notificationEvent.findMany({
      where: { commandRunId },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  return { timeline, transitions, errors, notifications };
}
