import { prisma } from "@sangfor/db";
import { z } from "zod";

import { logStateTransition } from "./audit";

export const createCustomerSchema = z.object({
  projectSlug: z.string().default("demo-project"),
  name: z.string().min(2),
  domain: z.string().optional(),
  industry: z.string().optional(),
  notes: z.string().optional(),
});

export const updateCustomerSchema = createCustomerSchema
  .omit({ projectSlug: true })
  .partial()
  .extend({ status: z.enum(["active", "inactive", "archived"]).optional() });

export const createPartnerSchema = z.object({
  projectSlug: z.string().default("demo-project"),
  name: z.string().min(2),
  partnerType: z.string().optional(),
});

export const updatePartnerSchema = createPartnerSchema
  .omit({ projectSlug: true })
  .partial()
  .extend({ status: z.enum(["active", "inactive", "archived"]).optional() });

export const createContactSchema = z.object({
  customerId: z.string().optional(),
  partnerId: z.string().optional(),
  name: z.string().min(2),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
});

/**
 * Purpose: Phase 12 Customer/Partner Core — CRM entities for production portal.
 * Failure Points: Missing project; duplicate partner link; orphan contact without parent.
 * Observability: customer_activity_logs, state_transition_logs
 */
async function resolveProjectId(slug: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

export async function createCustomer(input: z.infer<typeof createCustomerSchema>) {
  const parsed = createCustomerSchema.parse(input);
  const projectId = await resolveProjectId(parsed.projectSlug);

  const customer = await prisma.customer.create({
    data: {
      projectId,
      name: parsed.name,
      domain: parsed.domain,
      industry: parsed.industry,
      notes: parsed.notes,
    },
  });

  await prisma.customerActivityLog.create({
    data: {
      customerId: customer.id,
      activityType: "created",
      summary: `Customer ${customer.name} created`,
    },
  });

  await logStateTransition({
    entityType: "customer",
    entityId: customer.id,
    fromStatus: null,
    toStatus: "active",
    actorType: "user",
  });

  return customer;
}

export async function listCustomers(projectSlug = "demo-project", search?: string) {
  const projectId = await resolveProjectId(projectSlug);
  return prisma.customer.findMany({
    where: {
      projectId,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { domain: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      contacts: true,
      partnerLinks: { include: { partner: true } },
      _count: { select: { workTasks: true, activityLogs: true } },
    },
  });
}

/**
 * Lightweight customer list for the companies workspace: one query, only the
 * opportunity fields the detail panel actually renders. Replaces the previous
 * N+1 pattern (listCustomers + per-customer getCustomerDetail with 6 relations).
 */
export async function listCustomersWithOpportunities(projectSlug = "demo-project") {
  const projectId = await resolveProjectId(projectSlug);
  return prisma.customer.findMany({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    include: {
      contacts: { select: { id: true } },
      partnerLinks: { select: { id: true } },
      _count: { select: { workTasks: true } },
      opportunities: {
        orderBy: { updatedAt: "desc" },
        take: 10,
        select: { id: true, title: true, code: true, stage: true, amount: true },
      },
    },
  });
}

export async function getCustomerDetail(id: string) {
  return prisma.customer.findUnique({
    where: { id },
    include: {
      contacts: true,
      partnerLinks: { include: { partner: true } },
      activityLogs: { orderBy: { createdAt: "desc" }, take: 20 },
      workTasks: { orderBy: { dueAt: "asc" }, take: 10 },
      pocProjects: { orderBy: { updatedAt: "desc" }, take: 10 },
      opportunities: { orderBy: { updatedAt: "desc" }, take: 10 },
    },
  });
}

export async function updateCustomer(id: string, input: z.infer<typeof updateCustomerSchema>) {
  const parsed = updateCustomerSchema.parse(input);
  const customer = await prisma.customer.update({
    where: { id },
    data: parsed,
  });

  await prisma.customerActivityLog.create({
    data: {
      customerId: id,
      activityType: "updated",
      summary: `Customer ${customer.name} updated`,
      metadata: parsed,
    },
  });

  return customer;
}

export async function archiveCustomer(id: string) {
  return updateCustomer(id, { status: "archived" });
}

export async function createPartner(input: z.infer<typeof createPartnerSchema>) {
  const parsed = createPartnerSchema.parse(input);
  const projectId = await resolveProjectId(parsed.projectSlug);

  return prisma.partner.create({
    data: {
      projectId,
      name: parsed.name,
      partnerType: parsed.partnerType,
    },
  });
}

export async function listPartners(projectSlug = "demo-project") {
  const projectId = await resolveProjectId(projectSlug);
  return prisma.partner.findMany({
    where: { projectId },
    orderBy: { name: "asc" },
    include: {
      customerLinks: { include: { customer: true } },
      contacts: { orderBy: { createdAt: "asc" }, take: 1 },
      _count: { select: { contacts: true, opportunities: true } },
    },
  });
}

export async function getPartnerDetail(id: string) {
  return prisma.partner.findUnique({
    where: { id },
    include: {
      contacts: true,
      customerLinks: { include: { customer: true } },
      workTasks: { orderBy: { dueAt: "asc" }, take: 10 },
    },
  });
}

export async function updatePartner(id: string, input: z.infer<typeof updatePartnerSchema>) {
  const parsed = updatePartnerSchema.parse(input);
  return prisma.partner.update({
    where: { id },
    data: parsed,
  });
}

export async function archivePartner(id: string) {
  return updatePartner(id, { status: "archived" });
}

export async function createContact(input: z.infer<typeof createContactSchema>) {
  const parsed = createContactSchema.parse(input);
  if (!parsed.customerId && !parsed.partnerId) {
    throw new Error("contact_parent_required");
  }

  const contact = await prisma.contact.create({ data: parsed });

  if (parsed.customerId) {
    await prisma.customerActivityLog.create({
      data: {
        customerId: parsed.customerId,
        activityType: "contact_added",
        summary: `Contact ${contact.name} added`,
      },
    });
  }

  return contact;
}

export async function linkCustomerPartner(
  customerId: string,
  partnerId: string,
  linkType = "reseller",
) {
  const link = await prisma.customerPartnerLink.upsert({
    where: { customerId_partnerId: { customerId, partnerId } },
    update: { linkType },
    create: { customerId, partnerId, linkType },
  });

  await prisma.customerActivityLog.create({
    data: {
      customerId,
      activityType: "partner_linked",
      summary: `Partner linked (${linkType})`,
      metadata: { partnerId },
    },
  });

  return link;
}

export async function findConnectionCandidatesByEmail(email: string, projectSlug = "demo-project") {
  const projectId = await resolveProjectId(projectSlug);
  const domain = email.includes("@") ? email.split("@")[1]?.toLowerCase() : null;

  const [byContact, byDomain] = await Promise.all([
    prisma.contact.findMany({
      where: { email: { equals: email, mode: "insensitive" } },
      include: { customer: true, partner: true },
      take: 5,
    }),
    domain
      ? prisma.customer.findMany({
          where: {
            projectId,
            OR: [
              { domain: { equals: domain, mode: "insensitive" } },
              { domain: { contains: domain, mode: "insensitive" } },
            ],
          },
          take: 5,
        })
      : Promise.resolve([]),
  ]);

  return {
    contacts: byContact,
    customers: byDomain,
  };
}

export async function searchCustomers(projectSlug = "demo-project", search?: string) {
  return listCustomers(projectSlug, search);
}

export async function seedCustomerPartnerDemo(projectSlug = "demo-project") {
  const existing = await listCustomers(projectSlug);
  if (existing.length > 0) return { seeded: false, count: existing.length };

  const customer = await createCustomer({
    projectSlug,
    name: "Acme Manufacturing",
    domain: "acme.example.com",
    industry: "Manufacturing",
  });

  const partner = await createPartner({
    projectSlug,
    name: "Sangfor Korea Partner",
    partnerType: "reseller",
  });

  await linkCustomerPartner(customer.id, partner.id);
  await createContact({
    customerId: customer.id,
    name: "Kim Operator",
    email: "kim@acme.example.com",
    role: "IT Manager",
  });

  await prisma.workTask.create({
    data: {
      projectId: customer.projectId,
      customerId: customer.id,
      partnerId: partner.id,
      title: "Prepare customer kickoff",
      priority: "high",
      status: "todo",
      source: "seed",
    },
  });

  return { seeded: true, count: 1 };
}
