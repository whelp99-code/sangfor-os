import { describe, expect, it } from "vitest";

import {
  buildOpportunityOrchestratorSummary,
  buildPocOrchestratorSummary,
  buildProposalOrchestratorSummary,
} from "./portal-binding-summaries";

describe("portal-binding-summaries", () => {
  it("builds opportunity summary with key fields", () => {
    const text = buildOpportunityOrchestratorSummary({
      id: "opp-1",
      title: "Enterprise deal",
      stage: "qualification",
      amount: { toString: () => "10000" } as never,
      nextAction: "Send pricing",
      customer: { name: "Acme" },
    } as never);
    expect(text).toContain("Enterprise deal");
    expect(text).toContain("Acme");
    expect(text).toContain("Send pricing");
  });

  it("builds proposal summary with body preview", () => {
    const text = buildProposalOrchestratorSummary({
      id: "doc-1",
      title: "Sangfor proposal",
      status: "draft",
      bodyMarkdown: "# Scope\n\nHCI rollout",
      customer: { name: "Beta Corp" },
      template: { templateKey: "proposal-standard" },
      pocProject: null,
    } as never);
    expect(text).toContain("Sangfor proposal");
    expect(text).toContain("HCI rollout");
  });

  it("builds poc summary with module context fields", () => {
    const text = buildPocOrchestratorSummary({
      id: "poc-1",
      title: "HCI PoC",
      productLine: "HCI",
      deploymentType: "on-prem",
      requirementRows: [{ id: "r1", label: "Latency", details: "<5ms" }],
      issues: [{ id: "i1", title: "NIC driver", status: "open", severity: "high" }],
    } as never);
    expect(text).toContain("HCI PoC");
    expect(text).toContain("Latency");
    expect(text).toContain("NIC driver");
  });
});
