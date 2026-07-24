import type { AuthContext } from "@sangfor/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  tx: {
    project: {
      findFirst: vi.fn(),
    },
    taskLink: {
      findMany: vi.fn(),
    },
  },
  getCustomerDetail: vi.fn(),
  getOpportunityDetail: vi.fn(),
  getPartnerDetail: vi.fn(),
  searchKnowledgeWithCitations: vi.fn(),
  traceWorkflowEvent: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  withRlsTransaction: vi.fn(
    async (_ctx: unknown, callback: (tx: unknown) => Promise<unknown>) =>
      callback(harness.tx),
  ),
}));

vi.mock("../crm/customer-partner", () => ({
  getCustomerDetail: harness.getCustomerDetail,
  getPartnerDetail: harness.getPartnerDetail,
}));

vi.mock("../crm/opportunity-center", () => ({
  getOpportunityDetail: harness.getOpportunityDetail,
}));

vi.mock("../domain-ai/knowledge-search", () => ({
  searchKnowledgeWithCitations: harness.searchKnowledgeWithCitations,
}));

vi.mock("../crm/poc-center", () => ({
  getPocDetail: vi.fn(async () => null),
}));

vi.mock("../crm/proposal-generator", () => ({
  getGeneratedDocumentDetail: vi.fn(async () => null),
}));

vi.mock("../skills/portal-binding-summaries", () => ({
  buildOpportunityOrchestratorSummary: vi.fn(() => "Opportunity summary"),
  buildPocOrchestratorSummary: vi.fn(() => "PoC summary"),
  buildProposalOrchestratorSummary: vi.fn(() => "Proposal summary"),
}));

vi.mock("../platform/langfuse-observability", () => ({
  traceWorkflowEvent: harness.traceWorkflowEvent,
}));

import {
  buildContextPackSummaryText,
  buildOrchestratorContextPack,
  inferTemplateKeyFromSource,
} from "./context-pack-builder";
import { enrichPhase13RunWithContextPack } from "./orchestrator-bridge";
import { renderDeterministicTemplate } from "./template-registry";

const SALES: AuthContext = {
  userId: "user-sales",
  sessionId: "session-sales",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "opportunity.read"],
  product: "portal",
};

beforeEach(() => {
  vi.clearAllMocks();
  harness.tx.project.findFirst.mockResolvedValue({ slug: "scoped-project" });
  harness.tx.taskLink.findMany.mockResolvedValue([]);
  harness.getOpportunityDetail.mockResolvedValue(null);
  harness.getCustomerDetail.mockResolvedValue(null);
  harness.getPartnerDetail.mockResolvedValue(null);
  harness.searchKnowledgeWithCitations.mockResolvedValue([]);
});

describe("phase14 context pack", () => {
  it("produces deterministic template output without OpenAI", () => {
    const sections = [
      {
        key: "linkedTasks" as const,
        title: "Linked tasks",
        empty: true,
        content: "(no data)",
      },
    ];
    const pack = {
      sourceEntityType: null,
      sourceEntityId: null,
      templateKey: "dev-implementation-plan" as const,
      summaryText: buildContextPackSummaryText(sections),
      sections,
    };

    const output = renderDeterministicTemplate(
      "dev-implementation-plan",
      pack,
      "Add context pack engine",
    );

    expect(output.deterministic).toBe(true);
    expect(output.bodyMarkdown).toContain("Development implementation plan");
    expect(output.bodyMarkdown).toContain("Add context pack engine");
  });

  it("infers template key from the source type", () => {
    expect(inferTemplateKeyFromSource("proposal")).toBe("proposal-prd");
    expect(inferTemplateKeyFromSource("poc")).toBe("poc-experiment-plan");
    expect(inferTemplateKeyFromSource("opportunity")).toBe("dev-implementation-plan");
    expect(inferTemplateKeyFromSource(undefined, "release-closeout-plan")).toBe(
      "release-closeout-plan",
    );
  });

  it("uses authenticated context for opportunity, customer, project, and task reads", async () => {
    harness.getOpportunityDetail.mockResolvedValue({
      id: "opportunity-1",
      title: "Scoped opportunity",
      customerId: "customer-1",
      partnerId: null,
    });
    harness.getCustomerDetail.mockResolvedValue({
      id: "customer-1",
      name: "Scoped customer",
      domain: "scoped.example",
      industry: "IT",
      notes: null,
    });

    const pack = await buildOrchestratorContextPack(SALES, {
      sourceEntityType: "opportunity",
      sourceEntityId: "opportunity-1",
    });

    expect(harness.tx.project.findFirst).toHaveBeenCalledWith({
      where: { id: SALES.projectId, companyId: SALES.companyId },
      select: { slug: true },
    });
    expect(harness.getOpportunityDetail).toHaveBeenCalledWith(
      SALES,
      "opportunity-1",
    );
    expect(harness.getCustomerDetail).toHaveBeenCalledWith(SALES, "customer-1");
    expect(harness.tx.taskLink.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          entityId: "opportunity-1",
          workTask: { projectId: SALES.projectId, archivedAt: null },
        }),
      }),
    );
    expect(pack.sections.find((section) => section.key === "customer")?.empty).toBe(
      false,
    );
  });

  it("rejects caller-selected project scope", async () => {
    await expect(
      buildOrchestratorContextPack(SALES, {
        projectSlug: "attacker-project",
        sourceEntityType: "opportunity",
        sourceEntityId: "opportunity-1",
      }),
    ).rejects.toThrow("caller_selected_project_scope_forbidden");

    expect(harness.getOpportunityDetail).not.toHaveBeenCalled();
  });

  it("fails closed without AuthContext at the orchestration bridge", async () => {
    const result = await enrichPhase13RunWithContextPack({
      inputSummary: "Build the scoped context pack",
      sourceEntityType: "opportunity",
      sourceEntityId: "opportunity-1",
      includeContextPack: true,
    });

    expect(result.contextPack).toBeNull();
    expect(harness.getOpportunityDetail).not.toHaveBeenCalled();
  });
});
