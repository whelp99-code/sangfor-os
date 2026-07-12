import { prisma as realPrisma } from "@sangfor/db";
import { PROPOSAL_TEMPLATE_KEYS, type ProposalTemplateKey } from "@sangfor/shared";
import { z } from "zod";

import { loadLlmConfigFromDb } from "../platform/llm-settings";
import { getOpenAiApiKey } from "../platform/openai-config";
import { recordDecision } from "../governance/ai-decision";
import { caseRefFor } from "../infrastructure/case-ref";
import { resolveDefaultProjectSlug } from "../infrastructure/default-project";

export { PROPOSAL_TEMPLATE_KEYS, type ProposalTemplateKey };

/** Structural prisma type covering only what `buildVariables` reads — mirrors
 * domain-persistence.ts:38's DI seam pattern. Test-only injection point. */
export interface ProposalVariablesPrisma {
  customer: { findUnique: (args: { where: { id: string } }) => Promise<{ name: string } | null> };
  pocProject: {
    findUnique: (args: { where: { id: string } }) => Promise<{
      title: string;
      productName: string | null;
      deploymentType: string | null;
      hwSpec: string | null;
      swSpec: string | null;
      requirements: string | null;
    } | null>;
  };
}

const CUSTOMER_FACING_PROPOSAL_ACTIONS = ["send", "export", "share"] as const;

type ProposalAction = (typeof CUSTOMER_FACING_PROPOSAL_ACTIONS)[number] | "review" | "edit";

export function evaluateProposalAction(input: { status: string; action: ProposalAction | string }) {
  if (
    (CUSTOMER_FACING_PROPOSAL_ACTIONS as readonly string[]).includes(input.action) &&
    input.status !== "approved"
  ) {
    return { allowed: false, reason: "proposal_action_requires_approval" } as const;
  }
  return { allowed: true } as const;
}

export const generateProposalSchema = z.object({
  projectSlug: z.string().optional(),
  templateKey: z.enum(PROPOSAL_TEMPLATE_KEYS).default("standard-proposal"),
  customerId: z.string().optional(),
  pocProjectId: z.string().optional(),
  opportunityId: z.string().optional(),
  sourceMailCandidateId: z.string().optional(),
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
  const project = await realPrisma.project.findUniqueOrThrow({ where: { slug } });
  return project.id;
}

function applyTemplate(body: string, variables: Record<string, string>) {
  return Object.entries(variables).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    body,
  );
}

export async function ensureProposalTemplates(projectSlug?: string) {
  const projectId = await resolveProjectId(projectSlug ?? (await resolveDefaultProjectSlug()));
  for (const templateKey of PROPOSAL_TEMPLATE_KEYS) {
    await realPrisma.documentTemplate.upsert({
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

export async function buildVariables(
  customerId?: string,
  pocProjectId?: string,
  extra: Record<string, string> = {},
  deps: { prisma?: ProposalVariablesPrisma } = {},
) {
  const db = deps.prisma ?? (realPrisma as unknown as ProposalVariablesPrisma);
  let customerName = "Customer";
  if (customerId) {
    const customer = await db.customer.findUnique({ where: { id: customerId } });
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
    const poc = await db.pocProject.findUnique({ where: { id: pocProjectId } });
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

export async function maybeEnhanceWithLlm(
  body: string,
  title: string,
  deps: { buildContextPack?: (title: string) => Promise<string | null | undefined> } = {},
): Promise<string> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return body;

  try {
    const buildContextPack = deps.buildContextPack ?? (await import("../domain-ai/knowledge-search")).buildContextPack;
    const context = await buildContextPack(title);
    if (!context) return body;
    return `${body}\n\n## Knowledge context\n\n${context}`;
  } catch {
    return body;
  }
}

export async function generateProposal(input: z.infer<typeof generateProposalSchema>) {
  const parsed = generateProposalSchema.parse(input);
  const projectSlug = parsed.projectSlug ?? (await resolveDefaultProjectSlug());
  await loadLlmConfigFromDb(); // pick up web-saved OpenAI key for LLM enhancement
  await ensureProposalTemplates(projectSlug);
  const projectId = await resolveProjectId(projectSlug);

  const template = await realPrisma.documentTemplate.findUniqueOrThrow({
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

  const doc = await realPrisma.generatedDocument.create({
    data: {
      templateId: template.id,
      customerId: parsed.customerId,
      pocProjectId: parsed.pocProjectId,
      opportunityId: parsed.opportunityId,
      title: parsed.title,
      bodyMarkdown: finalBody,
      status: "draft",
    },
  });

  await realPrisma.documentVersion.create({
    data: {
      generatedDocumentId: doc.id,
      version: 1,
      bodyMarkdown: finalBody,
    },
  });

  return getGeneratedDocumentDetail(doc.id);
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "P2002",
  );
}

export async function saveDocumentVersion(
  documentId: string,
  bodyMarkdown: string,
) {
  // Resolve projectId before the retry loop (best-effort read via template FK).
  const doc = await realPrisma.generatedDocument.findUniqueOrThrow({
    where: { id: documentId },
    include: { template: { select: { projectId: true } } },
  });

  // Concurrent saves both computing `latest + 1` would collide on the
  // DocumentVersion @@unique([generatedDocumentId, version]). Compute the next
  // version and write the new row inside a single transaction, and retry when a
  // racing writer wins the version number (P2002) so the loser re-reads and
  // advances instead of failing.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await realPrisma.$transaction(async (tx) => {
        await tx.generatedDocument.findUniqueOrThrow({ where: { id: documentId } });
        const last = await tx.documentVersion.findFirst({
          where: { generatedDocumentId: documentId },
          orderBy: { version: "desc" },
        });
        const nextVersion = (last?.version ?? 0) + 1;

        await tx.generatedDocument.update({
          where: { id: documentId },
          data: { bodyMarkdown },
        });

        await tx.documentVersion.create({
          data: {
            generatedDocumentId: documentId,
            version: nextVersion,
            bodyMarkdown,
          },
        });
      });

      // S1: capture the human edit onto the decision spine (best-effort,
      // outside txn, never throws).
      await recordDecision({
        projectId: doc.template.projectId,
        domain: "sales",
        actor: "human",
        actionType: "entity_edit",
        caseRef: caseRefFor("proposal", documentId),
        outcome: "corrected",
        humanEdit: { bodyMarkdown },
      });

      return getGeneratedDocumentDetail(documentId);
    } catch (error) {
      // Version number was taken by a concurrent writer — retry with a fresh read.
      if (isUniqueViolation(error) && attempt < MAX_ATTEMPTS - 1) continue;
      throw error;
    }
  }

  return getGeneratedDocumentDetail(documentId);
}

export async function getGeneratedDocumentDetail(id: string) {
  return realPrisma.generatedDocument.findUnique({
    where: { id },
    include: {
      customer: true,
      template: true,
      pocProject: true,
      versions: { orderBy: { version: "desc" } },
    },
  });
}

export async function listGeneratedDocuments(projectSlug?: string) {
  const projectId = await resolveProjectId(projectSlug ?? (await resolveDefaultProjectSlug()));
  const templates = await realPrisma.documentTemplate.findMany({
    where: { projectId },
    select: { id: true },
  });
  const templateIds = templates.map((t) => t.id);
  return realPrisma.generatedDocument.findMany({
    where: { templateId: { in: templateIds } },
    orderBy: { createdAt: "desc" },
    include: { customer: true, template: true, pocProject: true },
  });
}

export async function archiveProposal(id: string) {
  return realPrisma.generatedDocument.update({ where: { id }, data: { status: "archived" } });
}

export async function listProposalTemplates(projectSlug?: string) {
  const slug = projectSlug ?? (await resolveDefaultProjectSlug());
  await ensureProposalTemplates(slug);
  const projectId = await resolveProjectId(slug);
  return realPrisma.documentTemplate.findMany({
    where: { projectId },
    orderBy: { templateKey: "asc" },
  });
}
