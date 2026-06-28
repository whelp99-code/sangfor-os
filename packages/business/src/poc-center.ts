import { prisma } from "@sangfor/db";
import { z } from "zod";

import { logStateTransition } from "./audit";

export const createPocSchema = z.object({
  projectSlug: z.string().default("demo-project"),
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

async function resolveProjectId(slug: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

export async function createPocProject(input: z.infer<typeof createPocSchema>) {
  const parsed = createPocSchema.parse(input);
  const projectId = await resolveProjectId(parsed.projectSlug);

  const poc = await prisma.pocProject.create({
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
    await prisma.opportunityLink.upsert({
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

  await prisma.pocChecklistItem.createMany({
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

  return getPocDetail(poc.id);
}

export async function listPocProjects(projectSlug = "demo-project") {
  const projectId = await resolveProjectId(projectSlug);
  return prisma.pocProject.findMany({
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

export async function getPocDetail(id: string) {
  return prisma.pocProject.findUnique({
    where: { id },
    include: {
      customer: true,
      partner: true,
      checklistItems: { orderBy: { sortOrder: "asc" } },
      issues: { orderBy: { createdAt: "desc" } },
      requirementRows: { orderBy: { sortOrder: "asc" } },
      events: { orderBy: { occurredAt: "desc" } },
      resultReports: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function togglePocChecklistItem(itemId: string, done: boolean) {
  return prisma.pocChecklistItem.update({
    where: { id: itemId },
    data: { done },
  });
}

export async function addPocIssue(
  pocProjectId: string,
  title: string,
  severity = "medium",
) {
  return prisma.pocIssue.create({
    data: { pocProjectId, title, severity },
  });
}

export async function updatePocIssue(
  issueId: string,
  input: z.infer<typeof updatePocIssueSchema>,
) {
  const parsed = updatePocIssueSchema.parse(input);
  return prisma.pocIssue.update({
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
  return prisma.pocProject.update({ where: { id }, data });
}

export async function addPocRequirement(
  pocProjectId: string,
  input: z.infer<typeof addPocRequirementSchema>,
) {
  const parsed = addPocRequirementSchema.parse(input);
  const count = await prisma.pocRequirement.count({ where: { pocProjectId } });
  return prisma.pocRequirement.create({
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
  return prisma.pocEvent.create({
    data: {
      pocProjectId,
      eventType: parsed.eventType,
      summary: parsed.summary,
      occurredAt: parsed.occurredAt ? new Date(parsed.occurredAt) : undefined,
    },
  });
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

  return prisma.pocResultReport.create({
    data: {
      pocProjectId,
      title: `${poc.title} Result Report`,
      bodyMarkdown: lines.join("\n"),
      status: "DRAFT",
    },
  });
}
