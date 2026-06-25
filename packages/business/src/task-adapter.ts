import { prisma } from "@sangfor/db";

import { createWorkTask } from "./task-center";

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
export async function migratePortalTasksToWorkTasks(projectSlug = "demo-project") {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug: projectSlug } });
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

export async function listUnifiedPortalTasks(projectSlug = "demo-project") {
  await migratePortalTasksToWorkTasks(projectSlug);
  const project = await prisma.project.findUniqueOrThrow({ where: { slug: projectSlug } });

  const tasks = await prisma.workTask.findMany({
    where: {
      projectId: project.id,
      source: { in: ["mail", "portal", "portal_legacy", "mail_candidate"] },
    },
    orderBy: { createdAt: "desc" },
    include: { customer: true, partner: true, links: true },
  });

  if (tasks.length === 0) {
    await createWorkTask({
      projectSlug,
      title: "Review AI mail groups",
      source: "portal",
      priority: "normal",
      status: "todo",
    });
    await createWorkTask({
      projectSlug,
      title: "Prepare PoC proposal",
      source: "portal",
      priority: "high",
      status: "todo",
    });
    return listUnifiedPortalTasks(projectSlug);
  }

  return tasks;
}

export async function countUnifiedPortalTasks(projectSlug = "demo-project") {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug: projectSlug } });
  await migratePortalTasksToWorkTasks(projectSlug);
  return prisma.workTask.count({
    where: {
      projectId: project.id,
      source: { in: ["mail", "portal", "portal_legacy", "mail_candidate"] },
    },
  });
}
