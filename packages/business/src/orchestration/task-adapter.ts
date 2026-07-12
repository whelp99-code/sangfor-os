import { prisma } from "@sangfor/db";

import { createWorkTask } from "./task-center";
import { resolveDefaultProjectSlug } from "../infrastructure/default-project";

const PORTAL_STATUS_MAP: Record<string, string> = {
  open: "todo",
  in_progress: "doing",
  done: "done",
  closed: "done",
};

/**
 * Purpose: Unify legacy portal_tasks into canonical work_tasks (Wave 1 blocker).
 * portal_tasks table remains read-only compatibility; new writes go to work_tasks.
 */
export async function migratePortalTasksToWorkTasks(projectSlug?: string) {
  const slug = projectSlug ?? (await resolveDefaultProjectSlug());
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });
  const legacy = await prisma.portalTask.findMany({ where: { projectId: project.id } });
  let migrated = 0;

  for (const row of legacy) {
    const existing = await prisma.workTask.findFirst({
      where: {
        projectId: project.id,
        title: row.title,
        source: "portal_legacy",
      },
    });
    if (existing) continue;

    await prisma.workTask.create({
      data: {
        projectId: project.id,
        title: row.title,
        status: PORTAL_STATUS_MAP[row.status] ?? "todo",
        source: "portal_legacy",
        priority: "normal",
      },
    });
    migrated += 1;
  }

  return { migrated, legacyCount: legacy.length };
}

export async function listUnifiedPortalTasks(projectSlug?: string) {
  const slug = projectSlug ?? (await resolveDefaultProjectSlug());
  await migratePortalTasksToWorkTasks(slug);
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });

  const tasks = await prisma.workTask.findMany({
    where: {
      projectId: project.id,
      archivedAt: null,
      source: { in: ["mail", "portal", "portal_legacy", "mail_candidate"] },
    },
    orderBy: { createdAt: "desc" },
    include: { customer: true, partner: true, links: true },
  });

  if (tasks.length === 0) {
    await createWorkTask({
      projectSlug: slug,
      title: "Review AI mail groups",
      source: "portal",
      priority: "normal",
      status: "todo",
    });
    await createWorkTask({
      projectSlug: slug,
      title: "Prepare PoC proposal",
      source: "portal",
      priority: "high",
      status: "todo",
    });
    return listUnifiedPortalTasks(slug);
  }

  return tasks;
}

export async function countUnifiedPortalTasks(projectSlug?: string) {
  const slug = projectSlug ?? (await resolveDefaultProjectSlug());
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });
  await migratePortalTasksToWorkTasks(slug);
  return prisma.workTask.count({
    where: {
      projectId: project.id,
      archivedAt: null,
      source: { in: ["mail", "portal", "portal_legacy", "mail_candidate"] },
    },
  });
}
