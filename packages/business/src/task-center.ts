import { prisma } from "@sangfor/db";
import { z } from "zod";

import { logStateTransition } from "./audit";

export const TASK_STATUSES = ["todo", "doing", "waiting", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/**
 * Single source of truth for the task state machine.
 * Forward flow: todo -> doing -> done. `waiting` rejoins the flow at `doing`.
 * Both the kanban board and the today board derive their "advance" action
 * from this map so the two views can never diverge again.
 */
export const TASK_NEXT_STATUS: Record<TaskStatus, TaskStatus | null> = {
  todo: "doing",
  doing: "done",
  waiting: "doing",
  done: null,
};

export function nextTaskStatus(status: string): TaskStatus | null {
  return TASK_NEXT_STATUS[status as TaskStatus] ?? null;
}

export const createWorkTaskSchema = z.object({
  projectSlug: z.string().default("demo-project"),
  title: z.string().min(2),
  status: z.enum(TASK_STATUSES).default("todo"),
  priority: z.enum(TASK_PRIORITIES).default("normal"),
  dueAt: z.string().datetime().optional(),
  customerId: z.string().optional(),
  partnerId: z.string().optional(),
  assigneeName: z.string().optional(),
  engagementId: z.string().optional(),
  source: z.string().default("manual"),
});

export const updateWorkTaskSchema = z.object({
  title: z.string().min(2).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  customerId: z.string().nullable().optional(),
  partnerId: z.string().nullable().optional(),
  assigneeName: z.string().nullable().optional(),
  engagementId: z.string().nullable().optional(),
});

export const linkTaskSchema = z.object({
  entityType: z.enum(["customer", "partner", "poc_project", "opportunity", "mail_message"]),
  entityId: z.string(),
  linkType: z.string().default("related"),
});

async function resolveProjectId(slug: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

async function recordStatusEvent(
  workTaskId: string,
  fromStatus: string | null,
  toStatus: string,
  actorType = "user",
) {
  await prisma.taskStatusEvent.create({
    data: { workTaskId, fromStatus, toStatus, actorType },
  });
}

export async function createWorkTask(input: z.infer<typeof createWorkTaskSchema>) {
  const parsed = createWorkTaskSchema.parse(input);
  const projectId = await resolveProjectId(parsed.projectSlug);

  const task = await prisma.workTask.create({
    data: {
      projectId,
      title: parsed.title,
      status: parsed.status,
      priority: parsed.priority,
      dueAt: parsed.dueAt ? new Date(parsed.dueAt) : undefined,
      customerId: parsed.customerId,
      partnerId: parsed.partnerId,
      assigneeName: parsed.assigneeName,
      engagementId: parsed.engagementId,
      source: parsed.source,
    },
  });

  await recordStatusEvent(task.id, null, task.status);
  await logStateTransition({
    entityType: "work_task",
    entityId: task.id,
    fromStatus: null,
    toStatus: task.status,
    actorType: "user",
  });

  return task;
}

export async function updateWorkTask(taskId: string, input: z.infer<typeof updateWorkTaskSchema>) {
  const parsed = updateWorkTaskSchema.parse(input);
  const existing = await prisma.workTask.findUniqueOrThrow({ where: { id: taskId } });

  const task = await prisma.workTask.update({
    where: { id: taskId },
    data: {
      ...parsed,
      dueAt:
        parsed.dueAt === null
          ? null
          : parsed.dueAt
            ? new Date(parsed.dueAt)
            : undefined,
    },
  });

  if (parsed.status && parsed.status !== existing.status) {
    await recordStatusEvent(taskId, existing.status, parsed.status);
    await logStateTransition({
      entityType: "work_task",
      entityId: taskId,
      fromStatus: existing.status,
      toStatus: parsed.status,
      actorType: "user",
    });
  }

  return task;
}

export async function updateWorkTaskStatus(taskId: string, status: string) {
  return updateWorkTask(taskId, { status: status as TaskStatus });
}

export async function listTasksByEngagement(engagementId: string) {
  return prisma.workTask.findMany({
    where: { engagementId },
    orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
    include: { customer: true, partner: true, links: true },
  });
}

export async function linkTaskToEntity(
  taskId: string,
  input: z.infer<typeof linkTaskSchema>,
) {
  const parsed = linkTaskSchema.parse(input);
  return prisma.taskLink.upsert({
    where: {
      workTaskId_entityType_entityId: {
        workTaskId: taskId,
        entityType: parsed.entityType,
        entityId: parsed.entityId,
      },
    },
    update: { linkType: parsed.linkType },
    create: {
      workTaskId: taskId,
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      linkType: parsed.linkType,
    },
  });
}

export async function listWorkTasks(
  projectSlug = "demo-project",
  filters?: { status?: string; customerId?: string; priority?: string },
) {
  const projectId = await resolveProjectId(projectSlug);
  return prisma.workTask.findMany({
    where: {
      projectId,
      ...(filters?.status ? { status: filters.status } : {}),
      ...(filters?.customerId ? { customerId: filters.customerId } : {}),
      ...(filters?.priority ? { priority: filters.priority } : {}),
    },
    orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
    include: { customer: true, partner: true, links: true },
  });
}

export async function listTasksForCustomer(customerId: string) {
  return prisma.workTask.findMany({
    where: { customerId },
    orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
    include: { links: true },
  });
}

export async function listTodayTasks(projectSlug = "demo-project") {
  const projectId = await resolveProjectId(projectSlug);
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return prisma.workTask.findMany({
    where: {
      projectId,
      status: { not: "done" },
      OR: [
        { dueAt: { gte: start, lt: end } },
        { dueAt: null, priority: { in: ["high", "urgent"] } },
      ],
    },
    orderBy: [{ priority: "desc" }, { dueAt: "asc" }],
    include: { customer: true, partner: true, links: true },
  });
}

export async function archiveWorkTask(id: string) {
  return prisma.workTask.delete({ where: { id } });
}

export async function getWorkTaskDetail(taskId: string) {
  return prisma.workTask.findUnique({
    where: { id: taskId },
    include: {
      customer: true,
      partner: true,
      links: true,
      statusEvents: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
}
