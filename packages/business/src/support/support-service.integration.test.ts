import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-ignore
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

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
        imageDigest: IMAGE_DIGEST,
        migrate: true,
        applicationRoleMode: "required",
      },
      async (ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => {
        process.env.DATABASE_URL = ctx.migrationDatabaseUrl;
        process.env.SANGFOR_APP_DATABASE_URL = ctx.databaseUrl;
        const { prisma } = await import("@sangfor/db");

        // Seed data
        await prisma.tenant.create({ data: { id: "u056-tenant", name: "U056 Tenant", slug: "u056-tenant", status: "active" } });
        await prisma.company.create({ data: { id: "u056-company", tenantId: "u056-tenant", name: "U056 Company", slug: "u056-company" } });
        await prisma.user.create({ data: { id: "u056-eng", email: "u056-eng@example.test", name: "U056 Engineer" } });
        await prisma.project.create({ data: { id: "u056-project", companyId: "u056-company", name: "U056 Project", slug: "u056-project" } });
        const member = await prisma.userCompanyRole.create({
          data: { id: "ucr-u056-eng", companyId: "u056-company", userId: "u056-eng", role: "support_engineer", status: "active", validFrom: new Date(Date.now() - 3600000) },
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
        const engagement = await prisma.engagement.create({ data: { id: "eng-u056-1", projectId: "u056-project", customerId: customer.id, opportunityId: opp.id, name: "U056 Engagement", status: "active" } });
        const artifact = await prisma.artifact.create({ data: { id: "art-u056-1", tenantId: "u056-tenant", companyId: "u056-company", projectId: "u056-project", artifactType: "proposal", classification: "internal", origin: "human", title: "U056 Artifact", createdByAssignmentId: member.id, ownerAssignmentId: member.id } });
        const { createArtifactVersion } = await import("../governance/artifact-service");
        const artifactVersion = await createArtifactVersion(
          { artifactId: artifact.id, expectedCurrentVersionId: null, expectedCurrentRevision: 0, content: "{}", contentType: "application/json" },
          { userId: "u056-eng", sessionId: "u056-session", scope: { tenantId: "u056-tenant", companyId: "u056-company", projectId: "u056-project" }, mfaVerifiedAt: new Date() },
          prisma,
        );
        const line = await prisma.quoteLineItem.create({ data: { id: "u056-line-1", quoteId: quote.id, quantity: 1, quantityDecimal: 1, currency: "USD", unitPrice: 1, costPrice: 1, revenue: 1, cost: 1, marginPct: 0 } });
        await prisma.productFamily.create({ data: { id: "u056-family", companyId: "u056-company", familyKey: "u056-family", vendor: "SANGFOR", name: "U056 Family", status: "ACTIVE" } });
        await prisma.productEdition.create({ data: { id: "u056-edition", familyId: "u056-family", editionKey: "u056-edition", name: "U056 Edition", version: "v1", status: "ACTIVE" } });
        await prisma.productSku.create({ data: { id: "u056-sku", editionId: "u056-edition", skuCode: "u056-sku", name: "U056 SKU", status: "active" } });

        const acceptance = await prisma.deliveryAcceptance.create({
          data: {
            engagementId: engagement.id, quoteId: quote.id, artifactVersionId: artifactVersion.versionId,
            acceptedByAssignmentId: member.id, acceptedAt: new Date(), acceptanceHash: hash("u056-acceptance"),
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
            effectiveAt: new Date(Date.now() - 3600000), contentHash: hash("u056-policy"),
          },
        });

        const asset = await prisma.customerAsset.create({
          data: {
            customerId: customer.id, assetType: "perpetual_product", name: "fw/ent/fw-ent-p",
            deliveryAcceptanceId: acceptance.id, sourceQuoteLineItemId: line.id, productFamilyId: "u056-family",
            productSkuId: "u056-sku", installedAt: new Date(),
          },
        });

        const supportService = await import("./support-service");

        const AUTH_CTX: any = {
          userId: "u056-eng", sessionId: "s1", tenantId: "u056-tenant", companyId: "u056-company", projectId: "u056-project",
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
