import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-ignore
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const CONTENT_HASH = hash("{}");

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
        imageDigest: IMAGE_DIGEST,
        migrate: true,
        applicationRoleMode: "required",
      },
      async (ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => {
        process.env.DATABASE_URL = ctx.migrationDatabaseUrl;
        process.env.SANGFOR_APP_DATABASE_URL = ctx.databaseUrl;
        const { prisma } = await import("@sangfor/db");
        const { applyU043RlsGrants } = await import("../crm/u043-grant.fixture");
        await applyU043RlsGrants(prisma as any);

        // Seed data
        await prisma.tenant.create({ data: { id: "u051-tenant", name: "U051 Tenant", slug: "u051-tenant", status: "active" } });
        await prisma.company.create({ data: { id: "u051-company", tenantId: "u051-tenant", name: "U051 Company", slug: "u051-company" } });
        await prisma.user.create({ data: { id: "u051-sales", email: "u051-sales@example.test", name: "U051 Sales" } });
        await prisma.project.create({ data: { id: "u051-project", companyId: "u051-company", name: "U051 Project", slug: "u051-project" } });
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

        const SALES_MGR = {
          userId: "u051-sales", sessionId: "s1", tenantId: "u051-tenant", companyId: "u051-company", projectId: "u051-project",
          businessRole: "sales_manager", permissions: [], product: "portal",
        };
        const artifactCaller = {
          userId: "u051-sales", sessionId: "s1",
          scope: { tenantId: "u051-tenant", companyId: "u051-company", projectId: "u051-project" },
          mfaVerifiedAt: new Date(),
        };
        await prisma.dealQualification.create({
          data: {
            opportunityId: opp.id, budgetScore: 20, authorityScore: 20, needScore: 24, timelineScore: 16,
            technicalFitScore: 20, scoreTotal: 100, weightedScore: 100, scoringVersion: "bant-tf-v1",
            revision: 1, passed: true, assessedByAssignmentId: "ucr-u051-sales", assessedAt: new Date(), updatedAt: new Date(),
            snapshotHash: hash("u051-qualification"),
          },
        });
        await prisma.productFamily.create({ data: { id: "u051-family", companyId: "u051-company", familyKey: "fw", vendor: "SANGFOR", name: "Firewall", status: "ACTIVE" } });
        await prisma.productEdition.create({ data: { id: "u051-edition", familyId: "u051-family", editionKey: "ent", name: "Enterprise", version: "v1", status: "ACTIVE" } });
        await prisma.licenseMetric.create({ data: { id: "u051-metric", productFamilyId: "u051-family", key: "u051-nodes", name: "Nodes", unit: "nodes", status: "ACTIVE" } });
        await prisma.productSku.create({ data: { id: "sku-fw-perm", editionId: "u051-edition", licenseMetricId: "u051-metric", skuCode: "fw-ent-p", name: "Perpetual", unitPrice: 20000, unitCost: 100, status: "active" } });
        await prisma.productSku.create({ data: { id: "sku-fw-sub", editionId: "u051-edition", licenseMetricId: "u051-metric", skuCode: "fw-sub-1y", name: "Subscription", unitPrice: 5000, unitCost: 100, termMonths: 12, status: "active" } });

        const { createArtifactVersion } = await import("../governance/artifact-service");
        const sizingArtifact = await prisma.artifact.create({ data: { id: "u051-sizing-artifact", tenantId: "u051-tenant", companyId: "u051-company", projectId: "u051-project", artifactType: "SIZING_TEMPLATE", classification: "internal", origin: "human", title: "U051 Sizing", createdByAssignmentId: "ucr-u051-sales", ownerAssignmentId: "ucr-u051-sales" } });
        const sizingVersion = await createArtifactVersion({ artifactId: sizingArtifact.id, expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: JSON.stringify({ version: "v1" }), contentType: "application/json" }, artifactCaller, prisma);
        await prisma.sizingTemplate.create({ data: { id: "u051-sizing", productFamilyId: "u051-family", templateKey: "u051-sizing", artifactId: sizingArtifact.id, activeArtifactVersionId: sizingVersion.versionId, name: "U051 Sizing", configJson: { version: "v1" }, status: "ACTIVE" } });
        const compatArtifact = await prisma.artifact.create({ data: { id: "u051-compat-artifact", tenantId: "u051-tenant", companyId: "u051-company", projectId: "u051-project", artifactType: "COMPATIBILITY_RULE", classification: "internal", origin: "human", title: "U051 Compatibility", createdByAssignmentId: "ucr-u051-sales", ownerAssignmentId: "ucr-u051-sales" } });
        const compatVersion = await createArtifactVersion({ artifactId: compatArtifact.id, expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: JSON.stringify({ compatible: true }), contentType: "application/json" }, artifactCaller, prisma);
        await prisma.compatibilityRule.create({ data: { id: "u051-compat-perm", sourceSkuId: "sku-fw-perm", targetSkuId: "sku-fw-sub", ruleKey: "u051-perm-sub", artifactId: compatArtifact.id, activeArtifactVersionId: compatVersion.versionId, ruleType: "compatible", configJson: { compatible: true }, status: "ACTIVE" } });
        await prisma.compatibilityRule.create({ data: { id: "u051-compat-sub", sourceSkuId: "sku-fw-sub", targetSkuId: "sku-fw-perm", ruleKey: "u051-sub-perm", artifactId: compatArtifact.id, activeArtifactVersionId: compatVersion.versionId, ruleType: "compatible", configJson: { compatible: true }, status: "ACTIVE" } });
        const { createQuoteVersion } = await import("../crm/quote-service");
        const quote = await createQuoteVersion(SALES_MGR as any, {
          opportunityId: opp.id, expectedCurrentQuoteId: null, currency: "USD",
          lines: [
            { lineType: "service", quantity: 1, unitPrice: 5000, costPrice: 100 },
            { lineType: "product", skuId: "sku-fw-perm", quantity: 2, unitPrice: 20000, costPrice: 100 },
            { lineType: "product", skuId: "sku-fw-sub", quantity: 5, termMonths: 12, unitPrice: 5000, costPrice: 100 },
          ],
        });
        const artVer = quote.artifactVersion!;

        const assessment = await prisma.aiQualityAssessment.create({
          data: {
            artifactVersionId: artVer.id, artifactContentHash: artVer.contentHash, resultHash: hash("u051-result"),
            policyKey: "policy.default", policyVersion: "1.0", evaluatorKey: "eval.default", evaluatorVersion: "1.0",
            score: 1, sourceCoverage: 1, confidenceBasis: {}, missingInfo: [], knownGaps: [], riskFlags: [],
            injectionDetected: false, leakageDetected: false, qualityPassed: true, assessedByAssignmentId: "ucr-u051-sales",
            idempotencyKey: "k-ass-u051", assessmentInputHash: hash("u051-assessment-input"), assessedAt: new Date(),
          },
        });

        // Seed Release Evaluation (U055)
        await prisma.aiReleaseEvaluation.create({
          data: {
            evaluationKey: hash("u051-evaluation-key"), evaluationInputHash: hash("u051-evaluation-input"), reviewSetHash: hash("u051-review-set"),
            artifactVersionId: artVer.id, artifactContentHash: quote.contentHash!, assessmentId: assessment.id,
            action: "quote.internal_release", policyKey: "policy.default", policyVersion: "1.0", policyHash: hash("u051-policy"),
            eligible: true, blockers: [], evaluatedAt: new Date(),
          },
        });

        const deliveryService = await import("./delivery-acceptance");

        const res = await deliveryService.acceptDeliveryProjection({
          authContext: SALES_MGR as any,
          engagementId: engagement.id,
          quoteId: quote.id,
          artifactVersionId: artVer.id,
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
