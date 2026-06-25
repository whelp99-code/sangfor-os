import { prisma } from "@sangfor/db";
import { PROPOSAL_TEMPLATE_KEYS, type ProposalTemplateKey } from "@sangfor/shared";
import { z } from "zod";

export { PROPOSAL_TEMPLATE_KEYS, type ProposalTemplateKey };

export const generateProposalSchema = z.object({
  projectSlug: z.string().default("demo-project"),
  templateKey: z.enum(PROPOSAL_TEMPLATE_KEYS).default("standard-proposal"),
  customerId: z.string().optional(),
  pocProjectId: z.string().optional(),
  title: z.string().min(2),
  variables: z.record(z.string()).default({}),
});

const TEMPLATE_BODIES: Record<(typeof PROPOSAL_TEMPLATE_KEYS)[number], string> = {
  "standard-proposal": `# Proposal for {{customer_name}}\n\n## Scope\n{{scope}}\n\n## Timeline\n{{timeline}}\n\n## Investment\n{{amount}}`,
  "poc-summary": `# PoC Summary — {{poc_title}}\n\nCustomer: {{customer_name}}\nProduct: {{product_name}}\n\n## Outcomes\n{{scope}}`,
  "technical-spec": `# Technical Specification\n\n## Environment\n{{deployment_type}}\n\n## Hardware\n{{hw_spec}}\n\n## Software\n{{sw_spec}}`,
  "pricing-sheet": `# Pricing Sheet\n\nCustomer: {{customer_name}}\n\n## Line items\n{{amount}}`,
  "executive-brief": `# Executive Brief\n\n{{customer_name}} — {{scope}}`,
  "implementation-plan": `# Implementation Plan\n\nTimeline: {{timeline}}\n\n## Phases\n{{scope}}`,
  "support-handoff": `# Support Handoff\n\nCustomer: {{customer_name}}\nNext steps: {{timeline}}`,
};

async function resolveProjectId(slug: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

function applyTemplate(body: string, variables: Record<string, string>) {
  return Object.entries(variables).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    body,
  );
}

export async function ensureProposalTemplates(projectSlug = "demo-project") {
  const projectId = await resolveProjectId(projectSlug);
  for (const templateKey of PROPOSAL_TEMPLATE_KEYS) {
    await prisma.documentTemplate.upsert({
      where: { projectId_templateKey: { projectId, templateKey } },
      update: {},
      create: {
        projectId,
        templateKey,
        title: templateKey.replace(/-/g, " "),
        bodyMarkdown: TEMPLATE_BODIES[templateKey],
      },
    });
  }
}

async function buildVariables(
  customerId?: string,
  pocProjectId?: string,
  extra: Record<string, string> = {},
) {
  let customerName = "Customer";
  if (customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    customerName = customer?.name ?? customerName;
  }

  const vars: Record<string, string> = {
    customer_name: customerName,
    scope: "Sangfor security platform PoC and rollout",
    timeline: "8 weeks",
    amount: "TBD",
    product_name: "—",
    poc_title: "—",
    deployment_type: "—",
    hw_spec: "—",
    sw_spec: "—",
    ...extra,
  };

  if (pocProjectId) {
    const poc = await prisma.pocProject.findUnique({ where: { id: pocProjectId } });
    if (poc) {
      vars.poc_title = poc.title;
      vars.product_name = poc.productName ?? "—";
      vars.deployment_type = poc.deploymentType ?? "—";
      vars.hw_spec = poc.hwSpec ?? "—";
      vars.sw_spec = poc.swSpec ?? "—";
      vars.scope = poc.requirements ?? vars.scope;
    }
  }

  return vars;
}

async function maybeEnhanceWithLlm(body: string, title: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return body;

  try {
    const { buildContextPack } = await import("./knowledge-search");
    const context = await buildContextPack(title);
    if (!context) return body;
    return `${body}\n\n## Knowledge context\n\n${context}`;
  } catch {
    return body;
  }
}

export async function generateProposal(input: z.infer<typeof generateProposalSchema>) {
  const parsed = generateProposalSchema.parse(input);
  await ensureProposalTemplates(parsed.projectSlug);
  const projectId = await resolveProjectId(parsed.projectSlug);

  const template = await prisma.documentTemplate.findUniqueOrThrow({
    where: {
      projectId_templateKey: { projectId, templateKey: parsed.templateKey },
    },
  });

  const variables = await buildVariables(
    parsed.customerId,
    parsed.pocProjectId,
    parsed.variables,
  );

  const bodyMarkdown = applyTemplate(template.bodyMarkdown, variables);
  const finalBody = await maybeEnhanceWithLlm(bodyMarkdown, parsed.title);

  const doc = await prisma.generatedDocument.create({
    data: {
      templateId: template.id,
      customerId: parsed.customerId,
      pocProjectId: parsed.pocProjectId,
      title: parsed.title,
      bodyMarkdown: finalBody,
      status: "draft",
    },
  });

  await prisma.documentVersion.create({
    data: {
      generatedDocumentId: doc.id,
      version: 1,
      bodyMarkdown: finalBody,
    },
  });

  return getGeneratedDocumentDetail(doc.id);
}

export async function saveDocumentVersion(
  documentId: string,
  bodyMarkdown: string,
) {
  const doc = await prisma.generatedDocument.findUniqueOrThrow({
    where: { id: documentId },
  });
  const last = await prisma.documentVersion.findFirst({
    where: { generatedDocumentId: documentId },
    orderBy: { version: "desc" },
  });
  const nextVersion = (last?.version ?? 0) + 1;

  await prisma.generatedDocument.update({
    where: { id: documentId },
    data: { bodyMarkdown },
  });

  await prisma.documentVersion.create({
    data: {
      generatedDocumentId: documentId,
      version: nextVersion,
      bodyMarkdown,
    },
  });

  return getGeneratedDocumentDetail(documentId);
}

export async function getGeneratedDocumentDetail(id: string) {
  return prisma.generatedDocument.findUnique({
    where: { id },
    include: {
      customer: true,
      template: true,
      pocProject: true,
      versions: { orderBy: { version: "desc" } },
    },
  });
}

export async function listGeneratedDocuments(projectSlug = "demo-project") {
  const projectId = await resolveProjectId(projectSlug);
  const templates = await prisma.documentTemplate.findMany({
    where: { projectId },
    select: { id: true },
  });
  const templateIds = templates.map((t) => t.id);
  return prisma.generatedDocument.findMany({
    where: { templateId: { in: templateIds } },
    orderBy: { createdAt: "desc" },
    include: { customer: true, template: true, pocProject: true },
  });
}

export async function listProposalTemplates(projectSlug = "demo-project") {
  await ensureProposalTemplates(projectSlug);
  const projectId = await resolveProjectId(projectSlug);
  return prisma.documentTemplate.findMany({
    where: { projectId },
    orderBy: { templateKey: "asc" },
  });
}
