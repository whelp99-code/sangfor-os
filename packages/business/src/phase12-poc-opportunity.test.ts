import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
loadEnv({ path: path.join(repoRoot, ".env") });

const integrationEnabled = process.env.CI_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("Phase 12 PoC center", () => {
  it("creates PoC with Sangfor checklist and requirements", async () => {
    const { createCustomer } = await import("./customer-partner");
    const {
      createPocProject,
      getPocDetail,
      addPocRequirement,
      addPocEvent,
      generatePocResultReport,
    } = await import("./poc-center");

    const customer = await createCustomer({
      projectSlug: "demo-project",
      name: `PoC Customer ${Date.now()}`,
    });

    const poc = await createPocProject({
      projectSlug: "demo-project",
      title: "Test PoC",
      customerId: customer.id,
      productName: "Sangfor HCI",
      productLine: "aCloud",
      deploymentType: "single-node",
      hwSpec: "aServer 2200",
      swSpec: "aCloud 6.8",
      networkNotes: "Mgmt VLAN 10",
    });

    expect(poc?.checklistItems.length).toBeGreaterThanOrEqual(6);
    expect(poc?.productLine).toBe("aCloud");

    await addPocRequirement(poc!.id, {
      label: "VM migration",
      details: "3 workloads",
    });
    await addPocEvent(poc!.id, {
      eventType: "kickoff",
      summary: "Kickoff meeting held",
    });

    const report = await generatePocResultReport(poc!.id);
    expect(report.bodyMarkdown).toContain("PoC Result Report");
    expect(report.bodyMarkdown).toContain("VM migration");

    const detail = await getPocDetail(poc!.id);
    expect(detail?.requirementRows.length).toBeGreaterThan(0);
    expect(detail?.events.length).toBeGreaterThan(0);
    expect(detail?.resultReports.length).toBeGreaterThan(0);
  }, 20_000);
});

describe.skipIf(!integrationEnabled)("Phase 12 opportunity center", () => {
  it("maps legacy stages and advances through canonical pipeline", async () => {
    const { createCustomer } = await import("./customer-partner");
    const { normalizeOpportunityStage } = await import("./opportunity-stage");
    const {
      createOpportunity,
      advanceOpportunityStage,
      getOpportunityDetail,
      addOpportunityLink,
    } = await import("./opportunity-center");
    const { createPocProject } = await import("./poc-center");

    const customer = await createCustomer({
      projectSlug: "demo-project",
      name: `Opp Customer ${Date.now()}`,
    });

    const opp = await createOpportunity({
      projectSlug: "demo-project",
      title: "Test opportunity",
      customerId: customer.id,
      stage: "discovery",
      probability: 30,
    });
    expect(normalizeOpportunityStage(opp.stage)).toBe("LEAD");

    const advanced = await advanceOpportunityStage(opp.id);
    expect(advanced.stage).toBe("QUALIFIED");

    const poc = await createPocProject({
      projectSlug: "demo-project",
      title: "Linked PoC",
      customerId: customer.id,
    });
    const link = await addOpportunityLink(opp.id, {
      entityType: "poc",
      entityId: poc!.id,
    });
    expect(link.entityType).toBe("poc");

    const detail = await getOpportunityDetail(opp.id);
    expect(detail?.stageEvents.length).toBeGreaterThan(1);
    expect(detail?.links.some((l) => l.entityId === poc!.id)).toBe(true);
  }, 20_000);

  it("summarizes pipeline by canonical stage", async () => {
    const { getOpportunityPipelineSummary } = await import("./opportunity-center");
    const { CANONICAL_STAGES } = await import("./opportunity-stage");
    const summary = await getOpportunityPipelineSummary();
    expect(summary.total).toBeGreaterThanOrEqual(0);
    for (const stage of CANONICAL_STAGES) {
      expect(summary.byStage[stage]).toBeDefined();
    }
  }, 15_000);
});

describe.skipIf(!integrationEnabled)("Phase 12 executive dashboard", () => {
  it("returns summary counts", async () => {
    const { getExecutiveSummary } = await import("./executive-dashboard");
    const summary = await getExecutiveSummary();
    expect(summary.customers).toBeGreaterThan(0);
    expect(summary.opportunities.total).toBeGreaterThanOrEqual(0);
  }, 15_000);
});
