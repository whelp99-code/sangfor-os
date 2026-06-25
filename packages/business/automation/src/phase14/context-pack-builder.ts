import { prisma } from "@ai-portal/db";
import { z } from "zod";

import { getCustomerDetail, getPartnerDetail } from "../customer-partner";
import { searchKnowledgeWithCitations } from "../knowledge-search";
import { getOpportunityDetail } from "../opportunity-center";
import { getPocDetail } from "../poc-center";
import { getGeneratedDocumentDetail } from "../proposal-generator";
import {
  buildOpportunityOrchestratorSummary,
  buildPocOrchestratorSummary,
  buildProposalOrchestratorSummary,
} from "../skills/portal-binding-summaries";
import type { ContextPack, ContextPackSection, ContextPackSectionKey } from "./types";
import { buildContextPackSchema, type TemplateKey } from "./types";

function emptySection(key: ContextPackSectionKey, title: string): ContextPackSection {
  return { key, title, empty: true, content: "(no data)" };
}

function filledSection(
  key: ContextPackSectionKey,
  title: string,
  content: string,
): ContextPackSection {
  const trimmed = content.trim();
  return {
    key,
    title,
    empty: trimmed.length === 0,
    content: trimmed.length > 0 ? trimmed : "(no data)",
  };
}

async function listLinkedTasksForEntity(entityType: string, entityId: string) {
  const links = await prisma.taskLink.findMany({
    where: { entityType, entityId },
    include: {
      workTask: { include: { customer: true, partner: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return links.map((link) => link.workTask);
}

function formatLinkedTasks(
  tasks: Awaited<ReturnType<typeof listLinkedTasksForEntity>>,
): string {
  if (tasks.length === 0) return "";
  return tasks
    .map(
      (task) =>
        `- [${task.status}/${task.priority}] ${task.title}${
          task.customer ? ` (customer: ${task.customer.name})` : ""
        }${task.partner ? ` (partner: ${task.partner.name})` : ""}`,
    )
    .join("\n");
}

function formatKnowledgeCitations(
  citations: Awaited<ReturnType<typeof searchKnowledgeWithCitations>>,
): string {
  if (citations.length === 0) return "";
  return citations
    .slice(0, 8)
    .map(
      (c, index) =>
        `${index + 1}. ${c.title} (chunk ${c.chunkIndex}, ${c.source})\n   ${c.excerpt}`,
    )
    .join("\n");
}

export function buildContextPackSummaryText(sections: ContextPackSection[]): string {
  const nonEmpty = sections.filter((section) => !section.empty);
  if (nonEmpty.length === 0) {
    return "Context pack: all sections empty (no linked entity data).";
  }
  return nonEmpty
    .map((section) => `## ${section.title}\n${section.content}`)
    .join("\n\n");
}

export function inferTemplateKeyFromSource(
  sourceEntityType?: string | null,
  explicit?: TemplateKey,
): TemplateKey | null {
  if (explicit) return explicit;
  switch (sourceEntityType) {
    case "proposal":
      return "proposal-prd";
    case "poc":
      return "poc-experiment-plan";
    case "opportunity":
      return "dev-implementation-plan";
    default:
      return null;
  }
}

export async function buildContextPack(
  input: z.infer<typeof buildContextPackSchema>,
): Promise<ContextPack> {
  const parsed = buildContextPackSchema.parse(input);
  const sections: ContextPackSection[] = [];

  let customerId: string | undefined;
  let partnerId: string | undefined;
  let knowledgeQuery = parsed.knowledgeQuery;

  if (parsed.sourceEntityType === "opportunity" && parsed.sourceEntityId) {
    const opportunity = await getOpportunityDetail(parsed.sourceEntityId);
    if (opportunity) {
      sections.push(
        filledSection(
          "opportunity",
          "Opportunity",
          buildOpportunityOrchestratorSummary(opportunity),
        ),
      );
      customerId = opportunity.customerId ?? undefined;
      partnerId = opportunity.partnerId ?? undefined;
      knowledgeQuery ??= opportunity.title;
    } else {
      sections.push(emptySection("opportunity", "Opportunity"));
    }
  } else {
    sections.push(emptySection("opportunity", "Opportunity"));
  }

  if (parsed.sourceEntityType === "proposal" && parsed.sourceEntityId) {
    const proposal = await getGeneratedDocumentDetail(parsed.sourceEntityId);
    if (proposal) {
      sections.push(
        filledSection(
          "proposal",
          "Proposal / PRD",
          buildProposalOrchestratorSummary(proposal),
        ),
      );
      customerId = proposal.customerId ?? customerId;
      knowledgeQuery ??= proposal.title;
    } else {
      sections.push(emptySection("proposal", "Proposal / PRD"));
    }
  } else {
    sections.push(emptySection("proposal", "Proposal / PRD"));
  }

  if (parsed.sourceEntityType === "poc" && parsed.sourceEntityId) {
    const poc = await getPocDetail(parsed.sourceEntityId);
    if (poc) {
      sections.push(
        filledSection("poc", "PoC project", buildPocOrchestratorSummary(poc)),
      );
      customerId = poc.customerId ?? customerId;
      partnerId = poc.partnerId ?? partnerId;
      knowledgeQuery ??= poc.title;
    } else {
      sections.push(emptySection("poc", "PoC project"));
    }
  } else {
    sections.push(emptySection("poc", "PoC project"));
  }

  if (customerId) {
    const customer = await getCustomerDetail(customerId);
    if (customer) {
      sections.push(
        filledSection(
          "customer",
          "Customer",
          [
            `Name: ${customer.name}`,
            customer.domain ? `Domain: ${customer.domain}` : null,
            customer.industry ? `Industry: ${customer.industry}` : null,
            customer.notes ? `Notes: ${customer.notes}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    } else {
      sections.push(emptySection("customer", "Customer"));
    }
  } else {
    sections.push(emptySection("customer", "Customer"));
  }

  if (partnerId) {
    const partner = await getPartnerDetail(partnerId);
    if (partner) {
      sections.push(
        filledSection(
          "partner",
          "Partner",
          [
            `Name: ${partner.name}`,
            partner.partnerType ? `Type: ${partner.partnerType}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      );
    } else {
      sections.push(emptySection("partner", "Partner"));
    }
  } else {
    sections.push(emptySection("partner", "Partner"));
  }

  if (parsed.sourceEntityType && parsed.sourceEntityId) {
    const tasks = await listLinkedTasksForEntity(
      parsed.sourceEntityType,
      parsed.sourceEntityId,
    );
    const taskContent = formatLinkedTasks(tasks);
    sections.push(
      taskContent
        ? filledSection("linkedTasks", "Linked tasks", taskContent)
        : emptySection("linkedTasks", "Linked tasks"),
    );
  } else {
    sections.push(emptySection("linkedTasks", "Linked tasks"));
  }

  const query = knowledgeQuery?.trim() || "Sangfor HCI PoC";
  try {
    const citations = await searchKnowledgeWithCitations({
      projectSlug: parsed.projectSlug,
      q: query,
    });
    const citationContent = formatKnowledgeCitations(citations);
    sections.push(
      citationContent
        ? filledSection("knowledgeCitations", "Knowledge citations", citationContent)
        : emptySection("knowledgeCitations", "Knowledge citations"),
    );
  } catch {
    sections.push(emptySection("knowledgeCitations", "Knowledge citations"));
  }

  const templateKey = inferTemplateKeyFromSource(
    parsed.sourceEntityType,
    parsed.templateKey,
  );

  return {
    sourceEntityType: parsed.sourceEntityType ?? null,
    sourceEntityId: parsed.sourceEntityId ?? null,
    templateKey,
    sections,
    summaryText: buildContextPackSummaryText(sections),
  };
}
