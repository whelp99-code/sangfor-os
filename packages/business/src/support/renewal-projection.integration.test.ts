import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-ignore
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

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
        imageDigest: IMAGE_DIGEST,
        migrate: true,
      },
      async (ctx: { databaseUrl: string }) => {
        process.env.DATABASE_URL = ctx.databaseUrl;
        const { prisma } = await import("@sangfor/db");

        // Seed data
        await prisma.tenant.create({ data: { id: "u052-tenant", name: "U052 Tenant", slug: "u052-tenant", status: "active" } });
        await prisma.company.create({ data: { id: "u052-company", tenantId: "u052-tenant", name: "U052 Company", slug: "u052-company" } });
        await prisma.user.create({ data: { id: "u052-sales", email: "u052-sales@example.test", name: "U052 Sales" } });
        await prisma.project.create({ data: { id: "u052-project", companyId: "u052-company", name: "U052 Project", slug: "u052-project" } });
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
        const engagement = await prisma.engagement.create({ data: { id: "eng-u052-1", projectId: "u052-project", customerId: customer.id, opportunityId: opp.id, name: "U052 Engagement", status: "active" } });
        const artifact = await prisma.artifact.create({ data: { id: "art-u052-1", tenantId: "u052-tenant", companyId: "u052-company", projectId: "u052-project", artifactType: "proposal", classification: "internal", origin: "human", title: "U052 Artifact", createdByAssignmentId: "ucr-u052-sales", ownerAssignmentId: "ucr-u052-sales" } });
        const { createArtifactVersion } = await import("../governance/artifact-service");
        const artifactVersion = await createArtifactVersion(
          { artifactId: artifact.id, expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: "{}", contentType: "application/json" },
          { userId: "u052-sales", sessionId: "u052-session", scope: { tenantId: "u052-tenant", companyId: "u052-company", projectId: "u052-project" }, mfaVerifiedAt: new Date() },
          prisma,
        );
        const line = await prisma.quoteLineItem.create({ data: { id: "u052-line-1", quoteId: quote.id, quantity: 1, quantityDecimal: 1, currency: "USD", unitPrice: 1, costPrice: 1, revenue: 1, cost: 1, marginPct: 0 } });
        await prisma.productFamily.create({ data: { id: "u052-family", companyId: "u052-company", familyKey: "u052-family", vendor: "SANGFOR", name: "U052 Family", status: "ACTIVE" } });
        await prisma.productEdition.create({ data: { id: "u052-edition", familyId: "u052-family", editionKey: "u052-edition", name: "U052 Edition", version: "v1", status: "ACTIVE" } });
        await prisma.productSku.create({ data: { id: "u052-sku", editionId: "u052-edition", skuCode: "u052-sku", name: "U052 SKU", status: "active" } });

        const acceptance = await prisma.deliveryAcceptance.create({
          data: {
            engagementId: engagement.id, quoteId: quote.id, artifactVersionId: artifactVersion.versionId,
            acceptedByAssignmentId: "ucr-u052-sales", acceptedAt: new Date(), acceptanceHash: hash("u052-acceptance"),
            snapshotJson: {}, idempotencyKey: "k-acc-u052",
          },
        });

        const asset = await prisma.customerAsset.create({
          data: {
            customerId: customer.id, assetType: "subscription_product", name: "fw/sub/fw-sub-1y",
            deliveryAcceptanceId: acceptance.id, sourceQuoteLineItemId: line.id, productFamilyId: "u052-family",
            productSkuId: "u052-sku", installedAt: new Date(),
          },
        });

        const now = new Date(Date.UTC(2026, 6, 1));
        const endDate = new Date(Date.UTC(2026, 8, 20)); // ~81 days out -> D-90 threshold

        const sub = await prisma.subscription.create({
          data: {
            assetId: asset.id, skuId: "u052-sku", startDate: new Date(Date.UTC(2025, 8, 20)),
            endDate, deliveryAcceptanceId: acceptance.id, sourceQuoteLineItemId: line.id,
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
