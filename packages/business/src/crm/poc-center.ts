import { prisma as realPrisma, Prisma } from "@sangfor/db";
import { z } from "zod";

import { logStateTransition } from "../governance/audit";
import { recordDecision } from "../governance/ai-decision";
import { caseRefFor } from "../infrastructure/case-ref";
import { resolveDefaultProjectSlug } from "../infrastructure/default-project";

/** Single source of truth for getPocDetail's include shape (used both at the
 * call site and to derive its precise return type below). */
const POC_DETAIL_INCLUDE = {
  customer: true,
  partner: true,
  checklistItems: { orderBy: { sortOrder: "asc" } },
  issues: { orderBy: { createdAt: "desc" } },
  requirementRows: { orderBy: { sortOrder: "asc" } },
  events: { orderBy: { occurredAt: "desc" } },
  resultReports: { orderBy: { createdAt: "desc" } },
} satisfies Prisma.PocProjectInclude;

/** Exact shape returned by `getPocDetail` — kept precise (not `any`) so
 * downstream consumers (e.g. skills/portal-binding-summaries.ts's
 * `ReturnType<typeof getPocDetail>`) keep full type inference through the DI seam. */
export type PocDetailRow = Prisma.PocProjectGetPayload<{ include: typeof POC_DETAIL_INCLUDE }>;

/**
 * Structural prisma type covering only the methods used by `createPocProject`
 * and `getPocDetail` (mirrors domain-persistence.ts:38's `PersistencePrisma`
 * DI seam). Test-only injection point; production callers always default to
 * the real client.
 */
export interface PocCenterPrisma {
  project: { findUniqueOrThrow: (args: { where: { slug: string } }) => Promise<{ id: string }> };
  pocProject: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: (args: any) => Promise<any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findUnique: (args: any) => Promise<any>;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  opportunityLink: { upsert: (args: any) => Promise<any> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pocChecklistItem: { createMany: (args: any) => Promise<any> };
}

export interface PocCenterDeps {
  prisma?: PocCenterPrisma;
}

export const createPocSchema = z.object({
  projectSlug: z.string().optional(),
  title: z.string().min(2),
  opportunityId: z.string().optional(),
  customerId: z.string().optional(),
  partnerId: z.string().optional(),
  productName: z.string().optional(),
  productLine: z.string().optional(),
  deploymentType: z.string().optional(),
  hwSpec: z.string().optional(),
  swSpec: z.string().optional(),
  networkNotes: z.string().optional(),
  scheduleAt: z.string().datetime().optional(),
  requirements: z.string().optional(),
});

export const addPocRequirementSchema = z.object({
  label: z.string().min(1),
  details: z.string().optional(),
});

export const addPocEventSchema = z.object({
  eventType: z.string().min(1),
  summary: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
});

export const updatePocProjectSchema = z.object({
  title: z.string().min(2).optional(),
  customerId: z.string().nullable().optional(),
  partnerId: z.string().nullable().optional(),
  productName: z.string().nullable().optional(),
  productLine: z.string().nullable().optional(),
  deploymentType: z.string().nullable().optional(),
  hwSpec: z.string().nullable().optional(),
  swSpec: z.string().nullable().optional(),
  networkNotes: z.string().nullable().optional(),
  scheduleAt: z.string().datetime().nullable().optional(),
  requirements: z.string().nullable().optional(),
  status: z.string().optional(),
});

export const updatePocIssueSchema = z.object({
  title: z.string().min(1).optional(),
  severity: z.string().optional(),
  status: z.enum(["open", "in_progress", "resolved"]).optional(),
});

const SANGFOR_CHECKLIST_DEFAULTS = [
  "Scope confirmation",
  "Hardware spec review",
  "Network topology review",
  "Environment setup",
  "Success criteria review",
  "Final result report",
];

async function resolveProjectId(slug: string, db: PocCenterPrisma) {
  const project = await db.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

export async function createPocProject(
  input: z.infer<typeof createPocSchema>,
  deps: PocCenterDeps = {},
) {
  const db = deps.prisma ?? (realPrisma as unknown as PocCenterPrisma);
  const parsed = createPocSchema.parse(input);
  const projectId = await resolveProjectId(parsed.projectSlug ?? (await resolveDefaultProjectSlug()), db);

  const poc = await db.pocProject.create({
    data: {
      projectId,
      title: parsed.title,
      opportunityId: parsed.opportunityId,
      customerId: parsed.customerId,
      partnerId: parsed.partnerId,
      productName: parsed.productName,
      productLine: parsed.productLine,
      deploymentType: parsed.deploymentType,
      hwSpec: parsed.hwSpec,
      swSpec: parsed.swSpec,
      networkNotes: parsed.networkNotes,
      scheduleAt: parsed.scheduleAt ? new Date(parsed.scheduleAt) : undefined,
      requirements: parsed.requirements,
    },
  });

  // P7 #6: going-forward, auto-link the POC to its opportunity (FK + audit link)
  // so engagement conversion's POC absorption works without a backfill.
  if (parsed.opportunityId) {
    await db.opportunityLink.upsert({
      where: {
        opportunityId_entityType_entityId: {
          opportunityId: parsed.opportunityId,
          entityType: "poc",
          entityId: poc.id,
        },
      },
      update: {},
      create: { opportunityId: parsed.opportunityId, entityType: "poc", entityId: poc.id, linkType: "confirmed" },
    });
  }

  await db.pocChecklistItem.createMany({
    data: SANGFOR_CHECKLIST_DEFAULTS.map((label, i) => ({
      pocProjectId: poc.id,
      label,
      sortOrder: i + 1,
    })),
  });

  await logStateTransition({
    entityType: "poc_project",
    entityId: poc.id,
    fromStatus: null,
    toStatus: "planning",
    actorType: "user",
  });

  return getPocDetail(poc.id, deps);
}

export async function listPocProjects(projectSlug?: string) {
  const projectId = await resolveProjectId(projectSlug ?? (await resolveDefaultProjectSlug()), realPrisma as unknown as PocCenterPrisma);
  return realPrisma.pocProject.findMany({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    include: {
      customer: true,
      partner: true,
      _count: {
        select: {
          checklistItems: true,
          issues: true,
          requirementRows: true,
          events: true,
          resultReports: true,
        },
      },
    },
  });
}

export async function getPocDetail(
  id: string,
  deps: PocCenterDeps = {},
): Promise<PocDetailRow | null> {
  const db = deps.prisma ?? (realPrisma as unknown as PocCenterPrisma);
  return db.pocProject.findUnique({
    where: { id },
    include: POC_DETAIL_INCLUDE,
  }) as Promise<PocDetailRow | null>;
}

export async function togglePocChecklistItem(itemId: string, done: boolean) {
  return realPrisma.pocChecklistItem.update({
    where: { id: itemId },
    data: { done },
  });
}

export async function addPocIssue(
  pocProjectId: string,
  title: string,
  severity = "medium",
) {
  return realPrisma.pocIssue.create({
    data: { pocProjectId, title, severity },
  });
}

export async function updatePocIssue(
  issueId: string,
  input: z.infer<typeof updatePocIssueSchema>,
) {
  const parsed = updatePocIssueSchema.parse(input);
  return realPrisma.pocIssue.update({
    where: { id: issueId },
    data: parsed,
  });
}

export async function updatePocProject(
  id: string,
  input: z.infer<typeof updatePocProjectSchema>,
) {
  const parsed = updatePocProjectSchema.parse(input);
  const data: Record<string, unknown> = {};
  if (parsed.title !== undefined) data.title = parsed.title;
  if (parsed.customerId !== undefined) data.customerId = parsed.customerId;
  if (parsed.partnerId !== undefined) data.partnerId = parsed.partnerId;
  if (parsed.productName !== undefined) data.productName = parsed.productName;
  if (parsed.productLine !== undefined) data.productLine = parsed.productLine;
  if (parsed.deploymentType !== undefined) data.deploymentType = parsed.deploymentType;
  if (parsed.hwSpec !== undefined) data.hwSpec = parsed.hwSpec;
  if (parsed.swSpec !== undefined) data.swSpec = parsed.swSpec;
  if (parsed.networkNotes !== undefined) data.networkNotes = parsed.networkNotes;
  if (parsed.requirements !== undefined) data.requirements = parsed.requirements;
  if (parsed.status !== undefined) data.status = parsed.status;
  if (parsed.scheduleAt !== undefined) {
    data.scheduleAt = parsed.scheduleAt ? new Date(parsed.scheduleAt) : null;
  }
  const updated = await realPrisma.pocProject.update({ where: { id }, data });
  // Best-effort decision spine capture — outside txn, never throws.
  await recordDecision({
    projectId: updated.projectId,
    domain: "sales",
    actor: "human",
    actionType: "entity_edit",
    caseRef: caseRefFor("poc", id),
    outcome: "corrected",
    humanEdit: data,
  });
  return updated;
}

export async function addPocRequirement(
  pocProjectId: string,
  input: z.infer<typeof addPocRequirementSchema>,
) {
  const parsed = addPocRequirementSchema.parse(input);
  const count = await realPrisma.pocRequirement.count({ where: { pocProjectId } });
  return realPrisma.pocRequirement.create({
    data: {
      pocProjectId,
      label: parsed.label,
      details: parsed.details,
      sortOrder: count + 1,
    },
  });
}

export async function addPocEvent(
  pocProjectId: string,
  input: z.infer<typeof addPocEventSchema>,
) {
  const parsed = addPocEventSchema.parse(input);
  return realPrisma.pocEvent.create({
    data: {
      pocProjectId,
      eventType: parsed.eventType,
      summary: parsed.summary,
      occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : undefined,
    },
  });
}

export async function archivePocProject(id: string) {
  return updatePocProject(id, { status: "archived" });
}

export async function generatePocResultReport(pocProjectId: string) {
  const poc = await getPocDetail(pocProjectId);
  if (!poc) throw new Error("poc_not_found");

  const doneItems = poc.checklistItems.filter((i) => i.done);
  const openItems = poc.checklistItems.filter((i) => !i.done);
  const lines = [
    `# ${poc.title} — PoC Result Report`,
    "",
    `**Product:** ${poc.productName ?? "—"} (${poc.productLine ?? "line TBD"})`,
    `**Deployment:** ${poc.deploymentType ?? "—"}`,
    "",
    "## Hardware / Software",
    `- HW: ${poc.hwSpec ?? "—"}`,
    `- SW: ${poc.swSpec ?? "—"}`,
    `- Network: ${poc.networkNotes ?? "—"}`,
    "",
    "## Requirements",
    ...(poc.requirementRows.length
      ? poc.requirementRows.map((r) => `- ${r.label}${r.details ? `: ${r.details}` : ""}`)
      : ["- (none recorded)"]),
    "",
    "## Checklist",
    `- Completed (${doneItems.length}): ${doneItems.map((i) => i.label).join(", ") || "—"}`,
    `- Open (${openItems.length}): ${openItems.map((i) => i.label).join(", ") || "—"}`,
    "",
    "## Issues",
    ...(poc.issues.length
      ? poc.issues.map((i) => `- [${i.severity}] ${i.title}`)
      : ["- No issues recorded"]),
    "",
    "## Events",
    ...(poc.events.length
      ? poc.events.map((e) => `- ${e.eventType}: ${e.summary}`)
      : ["- No events recorded"]),
  ];

  return realPrisma.pocResultReport.create({
    data: {
      pocProjectId,
      title: `${poc.title} Result Report`,
      bodyMarkdown: lines.join("\n"),
      status: "DRAFT",
    },
  });
}
