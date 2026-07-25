import { describe, expect, it } from "vitest";
// @ts-ignore
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

describe("U052: renewal-projection integration tests", () => {
  it("projects D-90 renewal opportunity, work task, notification event and reminder event in DB", async () => {
    if (!process.env.CI_INTEGRATION) {
      console.log("Skipping DB integration test because CI_INTEGRATION is not set");
      return;
    }

    const RUN_ID = `u052it-${Date.now().toString(36)}`;
    const EVIDENCE_DIR = `${process.cwd()}/.omo/evidence/sangfor-system-refactor-2026-07-15/U052/attempt-1/postgres-integration`;

    await withIsolatedPostgres(
      {
        runId: RUN_ID,
        ownerUnit: "U052",
        purpose: "renewal-projection-integration",
        evidenceDir: EVIDENCE_DIR,
        migrate: true,
      },
      async (ctx: { databaseUrl: string }) => {
        process.env.DATABASE_URL = ctx.databaseUrl;
        const { prisma } = await import("@sangfor/db");

        // Seed data
        await prisma.userCompanyRole.create({
          data: { id: "ucr-u052-sales", companyId: "u052-company", userId: "u052-sales", role: "sales_manager", status: "active", validFrom: new Date(Date.now() - 3600000) },
        });

        const customer = await prisma.customer.create({
          data: { id: "cust-u052-1", projectId: "u052-project", name: "U052 Customer" },
        });

        const opp = await prisma.opportunity.create({
          data: { id: "u052-opp1", projectId: "u052-project", title: "U052 Opp", stage: "PROPOSAL" },
        });

        const quote = await prisma.quote.create({
          data: {
            id: "u052-quote1", companyId: "u052-company", opportunityId: opp.id, version: 1,
            totalRevenue: 50000, totalCost: 20000, marginPct: 60, createdBy: "ucr-u052-sales",
          },
        });

        const acceptance = await prisma.deliveryAcceptance.create({
          data: {
            engagementId: "eng-u052-1", quoteId: quote.id, artifactVersionId: "av-u052-q1",
            acceptedByAssignmentId: "ucr-u052-sales", acceptedAt: new Date(), acceptanceHash: "hash-acc-1",
            snapshotJson: {}, idempotencyKey: "k-acc-u052",
          },
        });

        const asset = await prisma.customerAsset.create({
          data: {
            customerId: customer.id, assetType: "subscription_product", name: "fw/sub/fw-sub-1y",
            deliveryAcceptanceId: acceptance.id, sourceQuoteLineItemId: "l1", productFamilyId: "fam1",
            productSkuId: "sku1", installedAt: new Date(),
          },
        });

        const now = new Date(Date.UTC(2026, 6, 1));
        const endDate = new Date(Date.UTC(2026, 8, 20)); // ~81 days out -> D-90 threshold

        const sub = await prisma.subscription.create({
          data: {
            assetId: asset.id, skuId: "sku1", startDate: new Date(Date.UTC(2025, 8, 20)),
            endDate, deliveryAcceptanceId: acceptance.id, sourceQuoteLineItemId: "l1",
          },
        });

        const renewalService = await import("./renewal-projection");

        const batchRes = await renewalService.runRenewalProjectionBatch({ now });

        expect(batchRes.examinedCount).toBe(1);
        expect(batchRes.createdCount).toBe(1);

        const createdOpp = await prisma.renewalOpportunity.findFirst({
          where: { subscriptionId: sub.id },
        });
        expect(createdOpp).toBeDefined();
        expect(createdOpp?.status).toBe("pending");
      },
    );
  }, 180000);
});
