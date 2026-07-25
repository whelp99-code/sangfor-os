import { describe, expect, it } from "vitest";
// @ts-ignore
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

describe("U056: support-service integration tests", () => {
  it("creates support case with SLA snapshot and transitions status atomically in DB", async () => {
    if (!process.env.CI_INTEGRATION) {
      console.log("Skipping DB integration test because CI_INTEGRATION is not set");
      return;
    }

    const RUN_ID = `u056it-${Date.now().toString(36)}`;
    const EVIDENCE_DIR = `${process.cwd()}/.omo/evidence/sangfor-system-refactor-2026-07-15/U056/attempt-1/postgres-integration`;

    await withIsolatedPostgres(
      {
        runId: RUN_ID,
        ownerUnit: "U056",
        purpose: "support-sla-vendor-integration",
        evidenceDir: EVIDENCE_DIR,
        migrate: true,
      },
      async (ctx: { databaseUrl: string }) => {
        process.env.DATABASE_URL = ctx.databaseUrl;
        const { prisma } = await import("@sangfor/db");

        // Seed data
        const member = await prisma.userCompanyRole.create({
          data: { id: "ucr-u056-eng", companyId: "u056-company", userId: "u056-eng", role: "engineer", status: "active", validFrom: new Date(Date.now() - 3600000) },
        });

        const customer = await prisma.customer.create({
          data: { id: "cust-u056-1", projectId: "u056-project", name: "U056 Customer" },
        });

        const opp = await prisma.opportunity.create({
          data: { id: "u056-opp1", projectId: "u056-project", title: "U056 Opp", stage: "PROPOSAL" },
        });

        const quote = await prisma.quote.create({
          data: {
            id: "u056-quote1", companyId: "u056-company", opportunityId: opp.id, version: 1,
            totalRevenue: 50000, totalCost: 20000, marginPct: 60, createdBy: member.id,
          },
        });

        const acceptance = await prisma.deliveryAcceptance.create({
          data: {
            engagementId: "eng-u056-1", quoteId: quote.id, artifactVersionId: "av-u056-q1",
            acceptedByAssignmentId: member.id, acceptedAt: new Date(), acceptanceHash: "hash-acc-1",
            snapshotJson: {}, idempotencyKey: "k-acc-u056",
          },
        });

        const policy = await prisma.supportSlaPolicy.create({
          data: {
            id: "pol-crit", companyId: "u056-company", name: "Critical SLA Policy",
            isActive: true,
          },
        });

        const policyVer = await prisma.supportSlaPolicyVersion.create({
          data: {
            id: "policy-critical-v1", companyId: "u056-company", policyId: policy.id, version: 1, severity: "critical",
            responseMinutes: 60, resolutionMinutes: 240, clockKind: "elapsed_24x7",
            effectiveAt: new Date(Date.now() - 3600000), contentHash: "hash-pol1",
          },
        });

        const asset = await prisma.customerAsset.create({
          data: {
            customerId: customer.id, assetType: "perpetual_product", name: "fw/ent/fw-ent-p",
            deliveryAcceptanceId: acceptance.id, sourceQuoteLineItemId: "l1", productFamilyId: "fam1",
            productSkuId: "sku1", installedAt: new Date(),
          },
        });

        const supportService = await import("./support-service");

        const AUTH_CTX: any = {
          userId: member.id, sessionId: "s1", tenantId: "u056-tenant", companyId: "u056-company", projectId: "u056-project",
          businessRole: "sales_manager", permissions: [], product: "portal",
        };

        const sc = await supportService.createSupportCase({
          authContext: AUTH_CTX,
          assetId: asset.id,
          subject: "Hardware Fail",
          severity: "critical",
          ownerAssignmentId: member.id,
          idempotencyKey: "k-sc-create-u056",
          openedAt: new Date(),
        });

        expect(sc.id).toBeDefined();
        expect(sc.status).toBe("open");

        const snap = await prisma.supportCaseSlaSnapshot.findFirst({
          where: { supportCaseId: sc.id },
        });
        expect(snap).toBeDefined();
        expect(snap?.responseMinutes).toBe(60);

        const updated = await supportService.transitionSupportCaseStatus({
          authContext: AUTH_CTX,
          supportCaseId: sc.id,
          action: "respond",
          expectedRevision: 0,
          idempotencyKey: "k-sc-resp-u056",
          now: new Date(),
        });

        expect(updated.status).toBe("in_progress");
        expect(updated.revision).toBe(1);
      },
    );
  }, 180000);
});
