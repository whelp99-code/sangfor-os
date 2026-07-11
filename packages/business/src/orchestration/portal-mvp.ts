import { prisma } from "@sangfor/db";

import { createWorkTask, linkTaskToEntity } from "./task-center";
import { countUnifiedPortalTasks, listUnifiedPortalTasks } from "./task-adapter";

/**
 * Purpose: Phase 9 portal MVP — mock Outlook mail (real OAuth when OUTLOOK_* env set).
 * Task reads/writes use canonical work_tasks via task-adapter (Wave 1).
 */
export async function connectMockOutlook(projectSlug = "demo-project") {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug: projectSlug } });
  return prisma.mailAccount.upsert({
    where: { id: `${project.id}-outlook-mock` },
    update: { status: "mock_connected" },
    create: {
      id: `${project.id}-outlook-mock`,
      projectId: project.id,
      provider: "outlook",
      email: "operator@ai-portal.local",
      status: "mock_connected",
    },
  });
}

export async function syncMockMail(accountId: string) {
  const samples = [
    { subject: "PoC follow-up", fromEmail: "client@example.com", groupKey: "sales" },
    { subject: "Partnership intro", fromEmail: "partner@example.com", groupKey: "partner" },
    { subject: "Weekly ops sync", fromEmail: "team@example.com", groupKey: "internal" },
  ];

  const messages = [];
  for (const mail of samples) {
    const message = await prisma.mailMessage.create({
      data: { accountId, ...mail, bodyPreview: mail.subject },
    });
    messages.push(message);

    const domain = mail.fromEmail.split("@")[1];
    const customer = domain
      ? await prisma.customer.findFirst({
          where: { domain: { contains: domain, mode: "insensitive" } },
        })
      : null;

    const task = await createWorkTask({
      projectSlug: "demo-project",
      title: `Mail: ${mail.subject}`,
      source: "mail_candidate",
      priority: mail.groupKey === "sales" ? "high" : "normal",
      status: "todo",
      customerId: customer?.id,
    });

    await linkTaskToEntity(task.id, {
      entityType: "mail_message",
      entityId: message.id,
      linkType: "source",
    });
  }

  return prisma.mailMessage.findMany({ where: { accountId }, orderBy: { createdAt: "desc" } });
}

/** @deprecated Use listUnifiedPortalTasks — reads work_tasks only */
export async function listPortalTasks(projectSlug = "demo-project") {
  return listUnifiedPortalTasks(projectSlug);
}

export async function getPortalOverview(projectSlug = "demo-project") {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug: projectSlug } });
  const [accounts, messages, tasks] = await Promise.all([
    prisma.mailAccount.count({ where: { projectId: project.id } }),
    prisma.mailMessage.count(),
    countUnifiedPortalTasks(projectSlug),
  ]);
  return { accounts, messages, tasks };
}
