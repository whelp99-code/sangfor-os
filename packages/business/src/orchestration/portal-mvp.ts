import type { AuthContext } from "@sangfor/auth";
import { withRlsTransaction } from "@sangfor/db";
import { z } from "zod";

import { listCustomersWithOpportunities } from "../crm/customer-partner";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const idempotencyKeySchema = z.string().trim().min(1).max(128).refine(
  (value) => !CONTROL_CHARACTERS.test(value),
  "control_characters_not_allowed",
);

export const connectMockOutlookSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const syncMockMailSchema = z.object({
  expectedAccountUpdatedAt: z.string().datetime({ offset: true }),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/**
 * The legacy portal mock previously selected a default project and wrote a MailAccount directly.
 * No scoped mail-account command exists in the sealed dependency set, so this compatibility
 * adapter now fails closed with a persisted-workflow handoff instead of synthesizing authority.
 */
export async function connectMockOutlook(
  _ctx: AuthContext,
  rawCommand: z.input<typeof connectMockOutlookSchema>,
) {
  const command = connectMockOutlookSchema.parse(rawCommand);
  return {
    status: "review_required" as const,
    reason: "authenticated_mail_account_command_required",
    idempotencyKey: command.idempotencyKey,
    authenticatedApiPath: "/api/portal",
  };
}

/**
 * Produces scoped task drafts for the legacy mock messages. It deliberately performs no
 * MailAccount, MailMessage, WorkTask, or Customer mutation. Customer matching is delegated to
 * U043's canonical read service and every match is confined to the authenticated project.
 */
export async function syncMockMail(
  ctx: AuthContext,
  rawCommand: z.input<typeof syncMockMailSchema>,
) {
  const command = syncMockMailSchema.parse(rawCommand);
  const samples = [
    { subject: "PoC follow-up", fromEmail: "client@example.com", groupKey: "sales" },
    { subject: "Partnership intro", fromEmail: "partner@example.com", groupKey: "partner" },
    { subject: "Weekly ops sync", fromEmail: "team@example.com", groupKey: "internal" },
  ];

  const drafts = [];
  for (const mail of samples) {
    const domain = mail.fromEmail.split("@")[1]?.toLowerCase();
    const page = domain
      ? await listCustomersWithOpportunities(ctx, { domain, first: 1 })
      : { items: [] };
    drafts.push({
      title: `Mail: ${mail.subject}`,
      source: "mail_candidate",
      priority: mail.groupKey === "sales" ? "high" : "normal",
      status: "todo",
      customerId: page.items[0]?.id ?? null,
      fromEmail: mail.fromEmail,
    });
  }

  return {
    status: "review_required" as const,
    reason: "authenticated_mail_and_task_commands_required",
    expectedAccountUpdatedAt: command.expectedAccountUpdatedAt,
    idempotencyKey: command.idempotencyKey,
    authenticatedApiPath: "/api/portal",
    drafts,
  };
}

/** @deprecated Use the authenticated work-task surface; this adapter has no read authority. */
export async function listPortalTasks(_ctx: AuthContext) {
  return [];
}

export async function getPortalOverview(ctx: AuthContext) {
  return withRlsTransaction(ctx, async (tx) => {
    const [accounts, messages, tasks] = await Promise.all([
      tx.mailAccount.count({ where: { projectId: ctx.projectId } }),
      tx.mailMessage.count({ where: { account: { projectId: ctx.projectId } } }),
      tx.workTask.count({ where: { projectId: ctx.projectId, archivedAt: null } }),
    ]);
    return { accounts, messages, tasks };
  });
}
