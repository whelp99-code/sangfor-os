import { describe, expect, it } from "vitest";
// @ts-ignore
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

describe("U051: delivery-acceptance integration tests", () => {
  it("projects quote lines into customer assets, licenses, and subscriptions in one atomic transaction", async () => {
    if (!process.env.CI_INTEGRATION) {
      console.log("Skipping DB integration test because CI_INTEGRATION is not set");
      return;
    }

    const RUN_ID = `u051it-${Date.now().toString(36)}`;
    const EVIDENCE_DIR = `${process.cwd()}/.omo/evidence/sangfor-system-refactor-2026-07-15/U051/attempt-1/postgres-integration`;

    await withIsolatedPostgres(
      {
        runId: RUN_ID,
        ownerUnit: "U051",
        purpose: "delivery-acceptance-integration",
        evidenceDir: EVIDENCE_DIR,
        migrate: true,
      },
      async (ctx: { databaseUrl: string }) => {
        process.env.DATABASE_URL = ctx.databaseUrl;
        const { prisma } = await import("@sangfor/db");

        // Seed data
        await prisma.userCompanyRole.create({
          data: { id: "ucr-u051-sales", companyId: "u051-company", userId: "u051-sales", role: "sales_manager", status: "active", validFrom: new Date(Date.now() - 3600000) },
        });

        const customer = await prisma.customer.create({
          data: { id: "cust-u051-1", projectId: "u051-project", name: "U051 Customer" },
        });

        const opp = await prisma.opportunity.create({
          data: { id: "u051-opp1", projectId: "u051-project", title: "U051 Opp", stage: "PROPOSAL" },
        });

        const engagement = await prisma.engagement.create({
          data: { id: "eng-u051-1", projectId: "u051-project", customerId: customer.id, opportunityId: opp.id, name: "U051 Engagement", status: "active" },
        });

        const quote = await prisma.quote.create({
          data: {
            id: "u051-quote1", companyId: "u051-company", opportunityId: opp.id, version: 1,
            totalRevenue: 50000, totalCost: 20000, marginPct: 60, contentHash: "hash-u051-q1", artifactVersionId: "av-u051-q1", createdBy: "ucr-u051-sales",
          },
        });

        // Add quote lines
        await prisma.quoteLineItem.createMany({
          data: [
            { quoteId: quote.id, lineType: "service", quantity: 1, quantityDecimal: 1, unitPrice: 5000, costPrice: 100, revenue: 5000, cost: 100, marginPct: 98 },
            { quoteId: quote.id, lineType: "product", skuId: "sku-fw-perm", productFamilyKey: "fw", productEditionKey: "ent", skuCode: "fw-ent-p", licenseMetricKey: "cores", quantity: 1, quantityDecimal: 2, termMonths: 0, unitPrice: 20000, costPrice: 100, revenue: 20000, cost: 100, marginPct: 99 },
            { quoteId: quote.id, lineType: "product", skuId: "sku-fw-sub", productFamilyKey: "fw", productEditionKey: "sub", skuCode: "fw-sub-1y", licenseMetricKey: "nodes", quantity: 1, quantityDecimal: 5, termMonths: 12, unitPrice: 5000, costPrice: 100, revenue: 25000, cost: 100, marginPct: 99 },
          ],
        });

        // Seed Artifact & ArtifactVersion
        const artifact = await prisma.artifact.create({
          data: {
            id: "art-u051-1", tenantId: "u051-tenant", companyId: "u051-company", projectId: "u051-project",
            artifactType: "proposal", classification: "internal", origin: "user", title: "U051 Proposal",
            createdByAssignmentId: "ucr-u051-sales", ownerAssignmentId: "ucr-u051-sales",
          },
        });

        const artVer = await prisma.artifactVersion.create({
          data: {
            id: "av-u051-q1", artifactId: artifact.id, version: 1, contentHashVersion: "v1",
            canonicalContentEnvelope: "{}", contentHash: "hash-u051-q1", contentJson: {},
            status: "published", createdByAssignmentId: "ucr-u051-sales",
          },
        });

        const assessment = await prisma.aiQualityAssessment.create({
          data: {
            artifactVersionId: artVer.id, artifactContentHash: "hash-u051-q1", resultHash: "res-hash-1",
            policyKey: "policy.default", policyVersion: "1.0", evaluatorKey: "eval.default", evaluatorVersion: "1.0",
            score: 100, sourceCoverage: 1.0, confidenceBasis: {}, missingInfo: [], knownGaps: [], riskFlags: [],
            injectionDetected: false, leakageDetected: false, qualityPassed: true, assessedByAssignmentId: "ucr-u051-sales",
            idempotencyKey: "k-ass-u051", assessmentInputHash: "input-hash-1", assessedAt: new Date(),
          },
        });

        // Seed Release Evaluation (U055)
        await prisma.aiReleaseEvaluation.create({
          data: {
            evaluationKey: "key-eval-u051", evaluationInputHash: "input-hash-eval-1", reviewSetHash: "review-set-hash-1",
            artifactVersionId: artVer.id, artifactContentHash: "hash-u051-q1", assessmentId: assessment.id,
            action: "quote.internal_release", policyKey: "policy.default", policyVersion: "1.0", policyHash: "policy-hash-1",
            eligible: true, blockers: [], evaluatedAt: new Date(),
          },
        });

        const deliveryService = await import("./delivery-acceptance");

        const SALES_MGR = {
          userId: "u051-sales", sessionId: "s1", tenantId: "u051-tenant", companyId: "u051-company", projectId: "u051-project",
          businessRole: "sales_manager", permissions: [], product: "portal",
        };

        const res = await deliveryService.acceptDeliveryProjection({
          authContext: SALES_MGR as any,
          engagementId: engagement.id,
          quoteId: quote.id,
          artifactVersionId: "av-u051-q1",
          idempotencyKey: "k-acc-u051-it",
        });

        expect(res.acceptanceId).toBeDefined();
        expect(res.createdAssetsCount).toBe(2);
        expect(res.createdLicensesCount).toBe(2);
        expect(res.createdSubscriptionsCount).toBe(1);
      },
    );
  }, 180000);
});
