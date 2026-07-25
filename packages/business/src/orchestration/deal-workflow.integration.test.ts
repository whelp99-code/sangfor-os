import { describe, expect, it } from "vitest";
// @ts-ignore
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

describe("U050: deal-workflow integration tests", () => {
  it("enforces qualification, PoC requirements (AC-V31-BIZOPS-03) and commercial release gates in DB", async () => {
    if (!process.env.CI_INTEGRATION) {
      console.log("Skipping DB integration test because CI_INTEGRATION is not set");
      return;
    }

    const RUN_ID = `u050it-${Date.now().toString(36)}`;
    const EVIDENCE_DIR = `${process.cwd()}/.omo/evidence/sangfor-system-refactor-2026-07-15/U050/attempt-1/postgres-integration`;

    await withIsolatedPostgres(
      {
        runId: RUN_ID,
        ownerUnit: "U050",
        purpose: "deal-workflow-integration",
        evidenceDir: EVIDENCE_DIR,
        migrate: true,
      },
      async (ctx: { databaseUrl: string }) => {
        process.env.DATABASE_URL = ctx.databaseUrl;
        const { prisma } = await import("@sangfor/db");

        // Seed data
        await prisma.userCompanyRole.create({
          data: { id: "ucr-u050-sales", companyId: "u050-company", userId: "u050-sales", role: "sales_manager", status: "active", validFrom: new Date(Date.now() - 3600000) },
        });

        const opp = await prisma.opportunity.create({
          data: { id: "u050-opp1", projectId: "u050-project", title: "U050 Opp", stage: "PROPOSAL" },
        });

        const dealWfService = await import("./deal-workflow");

        const SALES_MGR = {
          userId: "u050-sales", sessionId: "s1", tenantId: "u050-tenant", companyId: "u050-company", projectId: "u050-project",
          businessRole: "sales_manager", permissions: [], product: "portal",
        };

        // 1. Without qualification -> expect error
        await expect(
          dealWfService.startDealWorkflowRun({
            authContext: SALES_MGR as any,
            opportunityId: opp.id,
            idempotencyKey: "k-wf-fail",
          }),
        ).rejects.toThrow("qualification (bant-tf-v1) is required");

        // Seed Qualification
        await prisma.dealQualification.create({
          data: {
            opportunityId: opp.id,
            budgetScore: 20,
            authorityScore: 20,
            needScore: 20,
            timelineScore: 25,
            weightedScore: 85,
            passed: true,
          },
        });

        // 2. Start run -> should succeed
        const runRes = await dealWfService.startDealWorkflowRun({
          authContext: SALES_MGR as any,
          opportunityId: opp.id,
          idempotencyKey: "k-wf-pass",
        });

        expect(runRes.runId).toBeDefined();

        // PoC requirements gate should be blocked because no requirementRows
        const pocGate = runRes.gates.find((g) => g.gateKey === "poc_requirements");
        expect(pocGate?.eligible).toBe(false);
        expect(pocGate?.blocker).toContain("POC_REQUIREMENTS_EMPTY");
      },
    );
  }, 180000);
});
