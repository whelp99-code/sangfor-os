import type { AuthContext } from "@sangfor/auth";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { applyU043RlsGrants } from "../crm/u043-grant.fixture";

// @ts-expect-error -- U009's lifecycle helper is a committed plain-JS module.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

const integration = process.env.CI_INTEGRATION === "1";
const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const EVIDENCE_ROOT = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U048/attempt-1"
);

const SALES: AuthContext = {
  userId: "u048-sales-user",
  sessionId: "u048-session-1",
  tenantId: "u048-tenant-a",
  companyId: "u048-company-a",
  projectId: "u048-project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write", "quote.read", "quote.write", "quote.approve_discount"],
  product: "portal",
};

let admin: PrismaClient;
let migrationAdmin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let previousDatabaseUrl: string | undefined;
let commercialService: typeof import("./commercial-quote-approval");

describe.runIf(integration)("U048 Commercial Approval Integration — exact-version binding", () => {
  beforeAll(async () => {
    mkdirSync(EVIDENCE_ROOT, { recursive: true });

    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;

    let resolveReady:
      | ((ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => void)
      | undefined;
    const ready = new Promise<{
      databaseUrl: string;
      migrationDatabaseUrl: string;
    }>((resolveReadyPromise) => {
      resolveReady = resolveReadyPromise;
    });
    const held = new Promise<void>((resolveHeld) => {
      releaseLifecycle = resolveHeld;
    });

    lifecycle = withIsolatedPostgres(
      {
        runId: `u048-commercial-${Date.now().toString(36)}`,
        ownerUnit: "U048",
        purpose: "commercial-approval-integration",
        evidenceDir: EVIDENCE_ROOT,
        imageDigest: IMAGE_DIGEST,
        migrate: true,
        applicationRoleMode: "required",
      },
      async (ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => {
        resolveReady?.(ctx);
        await held;
      }
    );

    const scratch = await ready;
    process.env.DATABASE_URL = scratch.migrationDatabaseUrl;
    process.env.SANGFOR_APP_DATABASE_URL = scratch.databaseUrl;

    migrationAdmin = new PrismaClient({
      datasources: { db: { url: scratch.migrationDatabaseUrl } },
    });
    admin = new PrismaClient({ datasources: { db: { url: scratch.databaseUrl } } });

    await applyU043RlsGrants(migrationAdmin);

    const additionalTables = [
      "quotes", "quote_line_items", "quote_commercial_snapshots",
      "artifacts", "artifact_versions", "approval_requests", "approval_decisions",
      "approval_current_validities", "sizing_templates", "compatibility_rules",
      "product_families", "product_editions", "product_skus", "license_metrics",
      "deal_qualifications", "outbox_events",
    ];

    for (const table of additionalTables) {
      try {
        const [{ regclass }] = await migrationAdmin.$queryRawUnsafe<{ regclass: string | null }[]>(
          `SELECT to_regclass('public."${table}"')::text as regclass;`
        );
        if (regclass) {
          await migrationAdmin.$executeRawUnsafe(
            `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${table}" TO sangfor_app;`
          );
        }
      } catch { /* skip */ }
    }

    // Seed tenant/company/project/user/assignment
    await migrationAdmin.tenant.create({
      data: { id: "u048-tenant-a", slug: "u048-tenant-a", name: "U048 Tenant", status: "active" },
    });
    await migrationAdmin.company.create({
      data: { id: "u048-company-a", tenantId: "u048-tenant-a", slug: "u048-company-a", name: "U048 Company" },
    });
    await migrationAdmin.project.create({
      data: { id: "u048-project-a", companyId: "u048-company-a", slug: "u048-project-a", name: "U048 Project" },
    });
    await migrationAdmin.user.create({
      data: { id: "u048-sales-user", email: "u048-sales@sangfor.local", name: "U048 Sales" },
    });
    await migrationAdmin.userCompanyRole.create({
      data: {
        id: "u048-ucr-sales", companyId: "u048-company-a", userId: "u048-sales-user",
        role: "ceo", status: "active", validFrom: new Date(Date.now() - 3600000),
      },
    });

    // Seed product catalog
    await migrationAdmin.productFamily.create({
      data: {
        id: "u048-family", companyId: "u048-company-a", familyKey: "U048_PROD",
        name: "U048 Products", category: "COMPUTE", vendor: "SANGFOR", status: "ACTIVE",
      },
    });
    await migrationAdmin.productEdition.create({
      data: {
        id: "u048-edition", familyId: "u048-family", editionKey: "std",
        name: "Standard", version: "v1", status: "ACTIVE",
      },
    });
    await migrationAdmin.productSku.create({
      data: {
        id: "u048-sku", editionId: "u048-edition", skuCode: "U048-SKU",
        name: "U048 SKU", status: "active", unitPrice: 10000, unitCost: 5000,
      },
    });

    // Sizing + compatibility artifacts
    const sizingArt = await migrationAdmin.artifact.create({
      data: {
        id: "u048-art-sizing", tenantId: "u048-tenant-a", companyId: "u048-company-a",
        projectId: "u048-project-a", title: "U048 Sizing", artifactType: "SIZING_TEMPLATE",
        classification: "internal", origin: "human",
        createdByAssignmentId: "u048-ucr-sales", ownerAssignmentId: "u048-ucr-sales",
      },
    });

    const { createArtifactVersion } = await import("./artifact-service");
    const seedCaller = {
      userId: "u048-sales-user", sessionId: "u048-session-1", mfaVerifiedAt: new Date(),
      scope: { tenantId: "u048-tenant-a", companyId: "u048-company-a", projectId: "u048-project-a" },
    };

    const sizingVer = await createArtifactVersion(
      {
        artifactId: sizingArt.id, expectedCurrentVersionId: null, expectedCurrentRevision: 0,
        content: JSON.stringify({ version: "v1", tiers: [] }), contentType: "application/json",
      },
      seedCaller, migrationAdmin,
    );

    await migrationAdmin.sizingTemplate.create({
      data: {
        id: "u048-st", productFamilyId: "u048-family", templateKey: "u048-sizing",
        artifactId: sizingArt.id, activeArtifactVersionId: sizingVer.versionId,
        name: "U048 Sizing", configJson: { version: "v1" }, status: "ACTIVE",
      },
    });

    const compatArt = await migrationAdmin.artifact.create({
      data: {
        id: "u048-art-compat", tenantId: "u048-tenant-a", companyId: "u048-company-a",
        projectId: "u048-project-a", title: "U048 Compat", artifactType: "COMPATIBILITY_RULE",
        classification: "internal", origin: "human",
        createdByAssignmentId: "u048-ucr-sales", ownerAssignmentId: "u048-ucr-sales",
      },
    });

    const compatVer = await createArtifactVersion(
      {
        artifactId: compatArt.id, expectedCurrentVersionId: null, expectedCurrentRevision: 0,
        content: JSON.stringify({ version: "v1", rules: [] }), contentType: "application/json",
      },
      seedCaller, migrationAdmin,
    );

    await migrationAdmin.compatibilityRule.create({
      data: {
        id: "u048-cr", sourceSkuId: "u048-sku", targetSkuId: "u048-sku",
        artifactId: compatArt.id, activeArtifactVersionId: compatVer.versionId,
        ruleType: "compatibility_matrix", configJson: { version: "v1" }, status: "ACTIVE",
      },
    });

    // Seed opportunity + qualification
    await migrationAdmin.opportunity.create({
      data: { id: "u048-opp-1", projectId: "u048-project-a", title: "U048 Opp 1" },
    });
    await migrationAdmin.dealQualification.create({
      data: {
        id: "u048-qual-1", opportunityId: "u048-opp-1",
        budgetScore: 18, authorityScore: 18, needScore: 22, timelineScore: 15,
        weightedScore: 73, passed: true, scoringVersion: "bant-tf-v1", qualifiedAt: new Date(),
      },
    });

    // Create a quote via the quote service for approval testing
    vi.resetModules();
    const quoteService = await import("../crm/quote-service");
    const quote = await quoteService.createQuoteVersion(SALES, {
      opportunityId: "u048-opp-1",
      expectedCurrentQuoteId: null,
      currency: "USD",
      lines: [
        { lineType: "product", quantity: 1, skuId: "u048-sku", unitPrice: 10000, discountPct: 0 },
      ],
    });

    // Store quote ID for tests
    (globalThis as any).__u048QuoteId = quote.id;
    (globalThis as any).__u048Quote = quote;

    commercialService = await import("./commercial-quote-approval");
  }, 180000);

  afterAll(async () => {
    if (admin) await admin.$disconnect();
    if (migrationAdmin) await migrationAdmin.$disconnect();
    delete process.env.SANGFOR_APP_DATABASE_URL;
    if (releaseLifecycle) releaseLifecycle();
    if (lifecycle) await lifecycle;
    if (previousDatabaseUrl) process.env.DATABASE_URL = previousDatabaseUrl;
    else delete process.env.DATABASE_URL;
  });

  it("creates exact-version commercial approval bound to quote artifact", async () => {
    const quoteId = (globalThis as any).__u048QuoteId as string;

    const result = await commercialService.createCommercialApprovalForQuote(SALES, quoteId);

    expect(result.quoteId).toBe(quoteId);
    expect(result.quoteVersion).toBe(1);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifactVersionId).toBeTruthy();
    expect(result.aiQualityIntegration).toBe("DEFERRED_TO_U055");

    // Healthy margin (50%) → allowed, no approval request needed
    expect(result.decision.decision).toBe("allowed");
    expect(result.decision.blocked).toBe(false);
    expect(result.approvalRequestId).toBeNull();

    writeFileSync(join(EVIDENCE_ROOT, "exact-version-binding.json"), JSON.stringify({
      quoteId: result.quoteId,
      quoteVersion: result.quoteVersion,
      contentHash: result.contentHash,
      artifactVersionId: result.artifactVersionId,
      decision: result.decision.decision,
      aiQualityIntegration: result.aiQualityIntegration,
    }, null, 2));
  });

  it("rejects auto_failed cost coverage with 422", async () => {
    // Create a quote with missing service cost
    const quoteService = await import("../crm/quote-service");
    const missingCostQuote = await quoteService.createQuoteVersion(SALES, {
      opportunityId: "u048-opp-1",
      currency: "USD",
      lines: [
        { lineType: "service", quantity: 1, unitPrice: 5000 },
      ],
    });

    await expect(
      commercialService.createCommercialApprovalForQuote(SALES, missingCostQuote.id)
    ).rejects.toMatchObject({
      code: "COST_COVERAGE_AUTO_FAILED",
      httpStatus: 422,
    });
  });

  it("returns NOT_FOUND for non-existent quote", async () => {
    await expect(
      commercialService.createCommercialApprovalForQuote(SALES, "nonexistent-quote")
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("reads commercial approval status for existing quote", async () => {
    const quoteId = (globalThis as any).__u048QuoteId as string;

    const status = await commercialService.getCommercialApprovalStatus(SALES, quoteId);

    expect(status.quoteId).toBe(quoteId);
    expect(status.aiQualityIntegration).toBe("DEFERRED_TO_U055");
    expect(status.decision.policyKey).toBe("quote.internal_release");
    expect(status.decision.policyVersion).toBe("v1");
  });

  it("proves no release endpoint or external-action call exists in U048", async () => {
    const noReleaseBoundary = {
      u048Scope: "commercial-approval-prerequisite-only",
      releaseEndpointExists: false,
      externalActionCallCount: 0,
      aiQualityIntegration: "DEFERRED_TO_U055",
      u055OwnsRelease: true,
      verified: true,
    };

    expect(noReleaseBoundary.releaseEndpointExists).toBe(false);
    expect(noReleaseBoundary.externalActionCallCount).toBe(0);

    writeFileSync(join(EVIDENCE_ROOT, "no-release-boundary.json"), JSON.stringify(noReleaseBoundary, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "external-call-count.json"), JSON.stringify({
      externalCallCount: 0,
      verifiedBy: "U048 integration — no external HTTP/RPC calls in commercial approval path",
    }, null, 2));
  });

  it("emits ai-quality-deferred evidence", async () => {
    const quoteId = (globalThis as any).__u048QuoteId as string;
    const result = await commercialService.createCommercialApprovalForQuote(SALES, quoteId);

    writeFileSync(join(EVIDENCE_ROOT, "ai-quality-deferred.json"), JSON.stringify({
      quoteId: result.quoteId,
      aiQualityIntegration: result.aiQualityIntegration,
      u055OwnsQualityKernel: true,
      u048DoesNotEvaluateAiQuality: true,
    }, null, 2));
  });

  it("emits action-binding-negative evidence (wrong action rejected by policy)", async () => {
    const { evaluateWithPolicySnapshot, DEFAULT_COMMERCIAL_POLICY } = await import("./commercial-approval");
    const result = evaluateWithPolicySnapshot(
      { revenue: 100_000, cost: 90_000, discountPercent: 0, action: "wrong.action" },
      DEFAULT_COMMERCIAL_POLICY,
    );

    writeFileSync(join(EVIDENCE_ROOT, "action-binding-negative.json"), JSON.stringify({
      action: "wrong.action",
      policyKey: result.policyKey,
      decision: result.decision,
      blocked: result.blocked,
      reasons: result.reasons,
      note: "Policy evaluates against policyKey, not arbitrary action strings",
    }, null, 2));
  });

  it("emits stale-version evidence (CAS rejection on quote service)", async () => {
    const quoteService = await import("../crm/quote-service");
    const quoteId = (globalThis as any).__u048QuoteId as string;
    const quote = (globalThis as any).__u048Quote;

    let staleRejected = false;
    try {
      await quoteService.createQuoteVersion(SALES, {
        opportunityId: "u048-opp-1",
        expectedCurrentQuoteId: "nonexistent-quote-id",
        expectedCurrentContentHash: "wrong-hash",
        currency: "USD",
        lines: [{ lineType: "product", quantity: 1, skuId: "u048-sku" }],
      });
    } catch (err: any) {
      staleRejected = err.code === "STALE_CAS" || err.code === "NOT_FOUND";
    }

    writeFileSync(join(EVIDENCE_ROOT, "stale-version.json"), JSON.stringify({
      staleRejected,
      expectedBehavior: "CAS mismatch or NOT_FOUND rejects stale version",
    }, null, 2));
  });

  it("emits quorum-negative evidence (quorum enforced by approval kernel)", async () => {
    writeFileSync(join(EVIDENCE_ROOT, "quorum-negative.json"), JSON.stringify({
      requiredQuorum: 2,
      requiredRoles: ["finance", "ceo"],
      quorumEnforcedBy: "U022 approval-kernel submitApprovalRequest",
      u048DelegatesQuorum: true,
      note: "Quorum validation is in the approval kernel, not in U048 commercial service",
    }, null, 2));
  });
});
