import { createWorkTask, linkTaskToEntity } from "@ai-portal/automation";
import { getMailOverview, listMailMessages } from "@ai-portal/mail-intelligence";

/**
 * Portal adapter for Track M mail-intelligence (read-only + task bridge).
 * OAuth/Graph/send/delete/move stay out of portal body.
 */
export async function getPortalMailOverview() {
  return getMailOverview();
}

export async function listPortalMailMessages(limit = 10) {
  return listMailMessages(limit);
}

export async function acceptMailTaskCandidate(input: {
  title: string;
  summary: string;
  mailMessageId: string;
  customerId?: string;
  partnerId?: string;
}) {
  const task = await createWorkTask({
    projectSlug: "demo-project",
    title: input.title,
    status: "todo",
    priority: "normal",
    customerId: input.customerId,
    partnerId: input.partnerId,
    source: "mail",
  });

  await linkTaskToEntity(task.id, {
    entityType: "mail_message",
    entityId: input.mailMessageId,
    linkType: "source",
  });

  return task;
}
