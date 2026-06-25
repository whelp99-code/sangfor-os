import type { getGeneratedDocumentDetail } from "../proposal-generator";
import type { getOpportunityDetail } from "../opportunity-center";
import type { getPocDetail } from "../poc-center";

type OpportunityDetail = NonNullable<Awaited<ReturnType<typeof getOpportunityDetail>>>;
type ProposalDetail = NonNullable<Awaited<ReturnType<typeof getGeneratedDocumentDetail>>>;
type PocDetail = NonNullable<Awaited<ReturnType<typeof getPocDetail>>>;

function lines(parts: Array<string | null | undefined>) {
  return parts.filter((part) => part != null && part.trim() !== "").join("\n");
}

export function buildOpportunityOrchestratorSummary(opportunity: OpportunityDetail) {
  return lines([
    "Phase 13 orchestrator — opportunity context",
    `Title: ${opportunity.title}`,
    `Customer: ${opportunity.customer?.name ?? "—"}`,
    `Stage: ${opportunity.stage}`,
    opportunity.amount != null ? `Amount: ${opportunity.amount.toString()}` : null,
    opportunity.nextAction ? `Next action: ${opportunity.nextAction}` : "Next action: —",
  ]);
}

export function buildProposalOrchestratorSummary(document: ProposalDetail) {
  const bodyPreview = document.bodyMarkdown.trim().slice(0, 800);
  return lines([
    "Phase 13 orchestrator — proposal / PRD context",
    `Title: ${document.title}`,
    document.customer ? `Customer: ${document.customer.name}` : null,
    document.template ? `Scope (template): ${document.template.templateKey}` : null,
    document.pocProject ? `Linked PoC: ${document.pocProject.title}` : null,
    `Status: ${document.status}`,
    `Document body:\n${bodyPreview}${document.bodyMarkdown.length > 800 ? "\n…" : ""}`,
  ]);
}

export function buildPocOrchestratorSummary(project: PocDetail) {
  const requirements =
    project.requirementRows.length > 0
      ? project.requirementRows
          .map((r) => `- ${r.label}${r.details ? `: ${r.details}` : ""}`)
          .join("\n")
      : "—";
  const openIssues = project.issues
    .filter((i) => i.status !== "resolved" && i.status !== "closed")
    .map((i) => `- [${i.status}/${i.severity}] ${i.title}`)
    .join("\n");

  return lines([
    "Phase 13 orchestrator — PoC assumptions / experiments context",
    `Title: ${project.title}`,
    project.productLine ? `Product line: ${project.productLine}` : null,
    project.deploymentType ? `Deployment: ${project.deploymentType}` : null,
    `Requirements:\n${requirements}`,
    `Open issues:\n${openIssues || "—"}`,
  ]);
}
