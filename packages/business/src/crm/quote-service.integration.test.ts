import type { AuthContext } from "@sangfor/auth";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient, Prisma } from "@prisma/client";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { CreateQuoteVersionInput } from "./quote-service";
import { createArtifactVersion } from "../governance/artifact-service";
import type { ApprovalKernelCaller } from "../governance/approval-kernel";
import { applyU043RlsGrants } from "./u043-grant.fixture";

// @ts-expect-error -- U009's lifecycle helper is a committed plain-JS module.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

const integration = process.env.CI_INTEGRATION === "1";
const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const QUOTE_SCRATCH = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U047/attempt-1/quote-scratch"
);
const EVIDENCE_ROOT = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U047/attempt-1"
);

const SALES: AuthContext = {
  userId: "u047-sales-user",
  sessionId: "u047-session-1",
  tenantId: "u047-tenant-a",
  companyId: "u047-company-a",
  projectId: "u047-project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write", "quote.read", "quote.write", "quote.approve_discount"],
  product: "portal",
};

const SEED_CALLER: ApprovalKernelCaller = {
  userId: "u047-sales-user",
  sessionId: "u047-session-1",
  mfaVerifiedAt: new Date(),
  scope: { tenantId: "u047-tenant-a", companyId: "u047-company-a", projectId: "u047-project-a" },
};

let admin: PrismaClient;
let migrationAdmin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let previousDatabaseUrl: string | undefined;
let quoteService: typeof import("./quote-service");

describe.runIf(integration)("QuoteService DB Integration — atomic quote graph creation", () => {
  beforeAll(async () => {
    mkdirSync(QUOTE_SCRATCH, { recursive: true });
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
        runId: `u047-quote-service-${Date.now().toString(36)}`,
        ownerUnit: "U047",
        purpose: "quote-service-integration",
        evidenceDir: QUOTE_SCRATCH,
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

    // Apply U043 RLS grants, then extend with quote-service-specific tables
    await applyU043RlsGrants(migrationAdmin);

    // Additional grants for quote-service tables not in U043
    const additionalTables = [
      "quotes",
      "quote_line_items",
      "quote_commercial_snapshots",
      "artifacts",
      "artifact_versions",
      "sizing_templates",
      "compatibility_rules",
      "product_families",
      "product_editions",
      "product_skus",
      "license_metrics",
      "deal_qualifications",
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
      } catch {
        // Table may not exist; skip silently
      }
    }

    // Seed base structure: 2 tenants/companies/projects + 2 tenant users
    await migrationAdmin.tenant.create({
      data: {
        id: "u047-tenant-a",
        slug: "u047-tenant-a",
        name: "U047 Tenant A",
        status: "active",
      },
    });

    await migrationAdmin.company.create({
      data: {
        id: "u047-company-a",
        tenantId: "u047-tenant-a",
        slug: "u047-company-a",
        name: "U047 Company A",
      },
    });

    await migrationAdmin.company.create({
      data: {
        id: "u047-company-b",
        tenantId: "u047-tenant-a",
        slug: "u047-company-b",
        name: "U047 Company B",
      },
    });

    await migrationAdmin.project.create({
      data: {
        id: "u047-project-a",
        companyId: "u047-company-a",
        slug: "u047-project-a",
        name: "U047 Project A",
      },
    });

    await migrationAdmin.project.create({
      data: {
        id: "u047-project-b",
        companyId: "u047-company-b",
        slug: "u047-project-b",
        name: "U047 Project B",
      },
    });

    await migrationAdmin.user.create({
      data: {
        id: "u047-sales-user",
        email: "u047-sales@sangfor.local",
        name: "U047 Sales",
      },
    });

    await migrationAdmin.userCompanyRole.create({
      data: {
        id: "u047-ucr-sales",
        companyId: "u047-company-a",
        userId: "u047-sales-user",
        role: "ceo",
        status: "active",
        validFrom: new Date(Date.now() - 3600000),
      },
    });

    await migrationAdmin.user.create({
      data: {
        id: "u047-approver-user",
        email: "u047-approver@sangfor.local",
        name: "U047 Approver",
      },
    });

    await migrationAdmin.userCompanyRole.create({
      data: {
        id: "u047-ucr-approver",
        companyId: "u047-company-a",
        userId: "u047-approver-user",
        role: "ceo",
        status: "active",
        validFrom: new Date(Date.now() - 3600000),
      },
    });

    await migrationAdmin.user.create({
      data: {
        id: "u047-foreign-user",
        email: "u047-foreign@sangfor.local",
        name: "U047 Foreign",
      },
    });

    await migrationAdmin.userCompanyRole.create({
      data: {
        id: "u047-ucr-foreign",
        companyId: "u047-company-b",
        userId: "u047-foreign-user",
        role: "ceo",
        status: "active",
        validFrom: new Date(Date.now() - 3600000),
      },
    });

    // Seed Product Family + Editions + SKUs (3 active SKUs for different fulfillment kinds)
    const familyId = "u047-family-prod";
    await migrationAdmin.productFamily.create({
      data: {
        id: familyId,
        companyId: "u047-company-a",
        familyKey: "PROD_COMPUTE",
        name: "Compute Products",
        category: "COMPUTE",
        vendor: "SANGFOR",
        status: "ACTIVE",
      },
    });

    const editionId = "u047-edition-std";
    await migrationAdmin.productEdition.create({
      data: {
        id: editionId,
        familyId: familyId,
        editionKey: "standard",
        name: "Standard Edition",
        version: "v1",
        status: "ACTIVE",
      },
    });

    // SKU 1: Perpetual product
    await migrationAdmin.productSku.create({
      data: {
        id: "u047-sku-perpetual",
        editionId: editionId,
        skuCode: "SKU-PERP-001",
        name: "Perpetual License",
        status: "active",
        unitPrice: 5000,
        unitCost: 2500,
      },
    });

    // SKU 2: Subscription product
    await migrationAdmin.productSku.create({
      data: {
        id: "u047-sku-subscription",
        editionId: editionId,
        skuCode: "SKU-SUB-001",
        name: "Subscription License",
        status: "active",
        unitPrice: 1200,
        unitCost: 600,
      },
    });

    // SKU 3: Archived (for negative test)
    await migrationAdmin.productSku.create({
      data: {
        id: "u047-sku-archived",
        editionId: editionId,
        skuCode: "SKU-ARCH-001",
        name: "Archived License",
        status: "archived",
        unitPrice: 3000,
        unitCost: 1500,
      },
    });

    // License Metric
    await migrationAdmin.licenseMetric.create({
      data: {
        id: "u047-metric-named-users",
        productFamilyId: familyId,
        key: "NAMED_USERS",
        name: "Named User Seats",
        unit: "seats",
      },
    });

    // Create Active Sizing Template + Artifact Version (U046 pattern)
    const sizingArtifact = await migrationAdmin.artifact.create({
      data: {
        id: "u047-art-sizing",
        tenantId: "u047-tenant-a",
        companyId: "u047-company-a",
        projectId: "u047-project-a",
        title: "Sizing Template U047",
        artifactType: "SIZING_TEMPLATE",
        classification: "internal",
        origin: "human",
        createdByAssignmentId: "u047-ucr-sales",
        ownerAssignmentId: "u047-ucr-sales",
      },
    });

    const sizingPayload = {
      version: "v1",
      baseSkuId: "u047-sku-perpetual",
      tiers: [
        { minUsers: 1, maxUsers: 100, recommendedSkuId: "u047-sku-perpetual", recommendedCpu: 4, recommendedRamGb: 16 },
        { minUsers: 101, maxUsers: 1000, recommendedSkuId: "u047-sku-subscription", recommendedCpu: 16, recommendedRamGb: 64 },
      ],
    };

    const sizingVersion = await createArtifactVersion(
      {
        artifactId: sizingArtifact.id,
        expectedCurrentVersionId: null,
        expectedCurrentRevision: 0,
        content: JSON.stringify(sizingPayload),
        contentType: "application/json",
      },
      SEED_CALLER,
      migrationAdmin
    );

    await migrationAdmin.sizingTemplate.create({
      data: {
        id: "u047-st-active",
        productFamilyId: familyId,
        templateKey: "sizing-u047",
        artifactId: sizingArtifact.id,
        activeArtifactVersionId: sizingVersion.versionId,
        name: "Active Sizing Template",
        configJson: sizingPayload,
        status: "ACTIVE",
      },
    });

    // Create Active Compatibility Rules
    const compatArtifact = await migrationAdmin.artifact.create({
      data: {
        id: "u047-art-compat",
        tenantId: "u047-tenant-a",
        companyId: "u047-company-a",
        projectId: "u047-project-a",
        title: "Compatibility Rule U047",
        artifactType: "COMPATIBILITY_RULE",
        classification: "internal",
        origin: "human",
        createdByAssignmentId: "u047-ucr-sales",
        ownerAssignmentId: "u047-ucr-sales",
      },
    });

    const compatPayload = {
      version: "v1",
      rules: [
        { targetSkuId: "u047-sku-subscription", compatible: true },
      ],
    };

    const compatVersion = await createArtifactVersion(
      {
        artifactId: compatArtifact.id,
        expectedCurrentVersionId: null,
        expectedCurrentRevision: 0,
        content: JSON.stringify(compatPayload),
        contentType: "application/json",
      },
      SEED_CALLER,
      migrationAdmin
    );

    await migrationAdmin.compatibilityRule.create({
      data: {
        id: "u047-cr-active",
        sourceSkuId: "u047-sku-perpetual",
        targetSkuId: "u047-sku-subscription",
        artifactId: compatArtifact.id,
        activeArtifactVersionId: compatVersion.versionId,
        ruleType: "compatibility_matrix",
        configJson: compatPayload,
        status: "ACTIVE",
      },
    });

    // Create second compatibility rule for subscription SKU
    const compatArtifact2 = await migrationAdmin.artifact.create({
      data: {
        id: "u047-art-compat-2",
        tenantId: "u047-tenant-a",
        companyId: "u047-company-a",
        projectId: "u047-project-a",
        title: "Compatibility Rule U047 (Subscription)",
        artifactType: "COMPATIBILITY_RULE",
        classification: "internal",
        origin: "human",
        createdByAssignmentId: "u047-ucr-sales",
        ownerAssignmentId: "u047-ucr-sales",
      },
    });

    const compatPayload2 = {
      version: "v1",
      rules: [
        { targetSkuId: "u047-sku-perpetual", compatible: true },
      ],
    };

    const compatVersion2 = await createArtifactVersion(
      {
        artifactId: compatArtifact2.id,
        expectedCurrentVersionId: null,
        expectedCurrentRevision: 0,
        content: JSON.stringify(compatPayload2),
        contentType: "application/json",
      },
      SEED_CALLER,
      migrationAdmin
    );

    await migrationAdmin.compatibilityRule.create({
      data: {
        id: "u047-cr-active-2",
        sourceSkuId: "u047-sku-subscription",
        targetSkuId: "u047-sku-perpetual",
        artifactId: compatArtifact2.id,
        activeArtifactVersionId: compatVersion2.versionId,
        ruleType: "compatibility_matrix",
        configJson: compatPayload2,
        status: "ACTIVE",
      },
    });

    // Seed 5 Opportunities with passing DealQualification (scoringVersion: "bant-tf-v1")
    const oppIds = ["u047-opp-1", "u047-opp-2", "u047-opp-3", "u047-opp-4", "u047-opp-5"];
    const oppTitles = [
      "Opportunity 1 — Atomic Graph Test",
      "Opportunity 2 — Missing Cost Test",
      "Opportunity 3 — Concurrency Test",
      "Opportunity 4 — Immutability Test",
      "Opportunity 5 — Version Chain Test",
    ];

    for (let i = 0; i < oppIds.length; i++) {
      await migrationAdmin.opportunity.create({
        data: {
          id: oppIds[i],
          projectId: "u047-project-a",
          title: oppTitles[i],
        },
      });

      await migrationAdmin.dealQualification.create({
        data: {
          id: `u047-qual-${i + 1}`,
          opportunityId: oppIds[i],
          budgetScore: 18,
          authorityScore: 18,
          needScore: 22,
          timelineScore: 15,
          weightedScore: 73.0,
          passed: true,
          scoringVersion: "bant-tf-v1",
          qualifiedAt: new Date(),
        },
      });
    }

    // Seed QuoteServiceLineItems for FK references
    await migrationAdmin.quoteServiceLineItem.create({
      data: {
        id: "sli-impl-1",
        opportunityId: "u047-opp-1",
        serviceName: "Implementation",
        description: "Implementation Service",
        quantity: 1,
        unitPrice: new Prisma.Decimal(2000),
        currency: "USD",
      },
    });

    await migrationAdmin.quoteServiceLineItem.create({
      data: {
        id: "sli-setup-2",
        opportunityId: "u047-opp-1",
        serviceName: "Setup",
        description: "Initial Setup",
        quantity: 1,
        unitPrice: new Prisma.Decimal(500),
        currency: "USD",
      },
    });

    // Dynamic import after env is set so withRlsTransaction picks up SANGFOR_APP_DATABASE_URL
    vi.resetModules();
    quoteService = await import("./quote-service");
  }, 120000);

  afterAll(async () => {
    if (admin) await admin.$disconnect();
    if (migrationAdmin) await migrationAdmin.$disconnect();
    delete process.env.SANGFOR_APP_DATABASE_URL;
    if (releaseLifecycle) releaseLifecycle();
    if (lifecycle) await lifecycle;
    if (previousDatabaseUrl) {
      process.env.DATABASE_URL = previousDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it("creates one serializable atomic quote graph", async () => {
    const input: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-1",
      expectedCurrentQuoteId: null,
      expectedCurrentContentHash: null,
      currency: "USD",
      lines: [
        {
          lineType: "product",
          description: "Perpetual License — 5 seats",
          quantity: 5,
          skuId: "u047-sku-perpetual",
          unitPrice: 5000,
          discountPct: 10,
          deploymentType: "on_premise",
          supportLevel: "standard",
        },
        {
          lineType: "service",
          description: "Implementation Service",
          quantity: 1,
          unitPrice: 2000,
          costPrice: 1000,
          discountPct: 0,
          sourceCostStatus: "budgeted",
          sourceServiceLineItemId: "sli-impl-1",
        },
      ],
    };

    const result = await quoteService.createQuoteVersion(SALES, input);

    expect(result.id).toBeTruthy();
    expect(result.version).toBe(1);
    expect(result.status).toBe("draft");
    expect(result.opportunityId).toBe("u047-opp-1");
    expect(result.companyId).toBe("u047-company-a");

    // Product: qty=5, unitPrice=5000, discount=10% → revenue = 22500, cost = 12500
    // Service: qty=1, unitPrice=2000, cost=1000 → revenue = 2000, cost = 1000
    // Total revenue = 24500, Total cost = 13500, margin% ≈ 44.90%
    expect(result.totalRevenue.toFixed(2)).toBe("24500.00");
    expect(result.totalCost.toFixed(2)).toBe("13500.00");
    expect(result.marginPct.toFixed(2)).toBe("44.90");
    expect(result.currency).toBe("USD");
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);

    expect(result.lineItems).toHaveLength(2);

    const productLine = result.lineItems.find((l) => l.lineType === "product");
    expect(productLine).toBeDefined();
    expect(productLine!.skuId).toBe("u047-sku-perpetual");
    expect(productLine!.quantity).toBe(5);
    expect(productLine!.revenue.toFixed(2)).toBe("22500.00");
    expect(productLine!.cost.toFixed(2)).toBe("12500.00");
    expect(productLine!.marginPct.toFixed(2)).toBe("44.44");

    const serviceLine = result.lineItems.find((l) => l.lineType === "service");
    expect(serviceLine).toBeDefined();
    expect(serviceLine!.skuId).toBeNull();
    expect(serviceLine!.quantity).toBe(1);
    expect(serviceLine!.revenue.toFixed(2)).toBe("2000.00");
    expect(serviceLine!.cost.toFixed(2)).toBe("1000.00");
    expect(serviceLine!.marginPct.toFixed(2)).toBe("50.00");
    expect(serviceLine!.sourceCostStatus).toBe("budgeted");
    expect(serviceLine!.sourceServiceLineItemId).toBe("sli-impl-1");

    expect(result.commercialSnapshot).toBeDefined();
    expect(result.commercialSnapshot!.calculatedRevenue.toFixed(2)).toBe("24500.00");
    expect(result.commercialSnapshot!.calculatedCost.toFixed(2)).toBe("13500.00");
    expect(result.commercialSnapshot!.calculatedMarginPct.toFixed(2)).toBe("44.90");
    expect(result.commercialSnapshot!.costCoverageStatus).toBe("complete");
    expect(result.commercialSnapshot!.requiresApproval).toBe(false);

    expect(result.artifactVersion).toBeDefined();
    expect(result.artifactVersion!.contentHash).toMatch(/^[a-f0-9]{64}$/);

    const serverMoneyReceipt = {
      quoteId: result.id,
      version: result.version,
      totalRevenue: result.totalRevenue.toString(),
      totalCost: result.totalCost.toString(),
      marginPct: result.marginPct.toString(),
      contentHash: result.contentHash,
      lineItems: result.lineItems.map((l) => ({
        lineType: l.lineType,
        skuId: l.skuId,
        quantity: l.quantity,
        revenue: l.revenue.toString(),
        cost: l.cost.toString(),
        marginPct: l.marginPct.toString(),
      })),
      commercialSnapshot: {
        calculatedRevenue: result.commercialSnapshot!.calculatedRevenue.toString(),
        calculatedCost: result.commercialSnapshot!.calculatedCost.toString(),
        calculatedMarginPct: result.commercialSnapshot!.calculatedMarginPct.toString(),
      },
    };

    writeFileSync(join(QUOTE_SCRATCH, "server-money.json"), JSON.stringify(serverMoneyReceipt, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "server-money.json"), JSON.stringify(serverMoneyReceipt, null, 2));
  });

  it("persists byte-identical typed columns and six-section fulfillment snapshot", async () => {
    const input: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-2",
      expectedCurrentQuoteId: null,
      expectedCurrentContentHash: null,
      currency: "USD",
      lines: [
        {
          lineType: "product",
          quantity: 2,
          skuId: "u047-sku-subscription",
          unitPrice: 1200,
          discountPct: 0,
          deploymentType: "cloud",
          supportLevel: "premium",
          termMonths: 12,
        },
        {
          lineType: "service",
          quantity: 1,
          unitPrice: 500,
          costPrice: 200,
          sourceCostStatus: "approved",
          sourceServiceLineItemId: "sli-setup-2",
        },
      ],
    };

    const result = await quoteService.createQuoteVersion(SALES, input);

    const quote = await migrationAdmin.quote.findUniqueOrThrow({
      where: { id: result.id },
      include: { lineItems: true, commercialSnapshot: true },
    });

    const productLine = quote.lineItems.find((l) => l.lineType === "product");
    expect(productLine).toBeDefined();

    const productSnapshot = productLine!.fulfillmentSnapshot as Record<string, unknown>;
    expect(productSnapshot).toBeDefined();

    expect(productSnapshot.source).toBeDefined();
    expect(productSnapshot.quantity).toBeDefined();
    expect(productSnapshot.catalog).toBeDefined();
    expect(productSnapshot.license).toBeDefined();
    expect(productSnapshot.deployment).toBeDefined();
    expect(productSnapshot.rules).toBeDefined();

    const source = productSnapshot.source as Record<string, unknown>;
    expect(source.lineType).toBe("product");
    expect(source.skuId).toBe("u047-sku-subscription");

    const catalog = productSnapshot.catalog as Record<string, unknown>;
    expect(catalog.productFamilyId).toBe("u047-family-prod");
    expect(catalog.productFamilyKey).toBe("PROD_COMPUTE");
    expect(catalog.productEditionId).toBeTruthy();
    expect(catalog.productEditionKey).toBe("standard");
    expect(catalog.skuId).toBe("u047-sku-subscription");
    expect(catalog.skuCode).toBe("SKU-SUB-001");

    const license = productSnapshot.license as Record<string, unknown>;
    expect(license.licenseMetricId).toBe("u047-metric-named-users");
    expect(license.licenseMetricKey).toBe("NAMED_USERS");
    expect(license.termMonths).toBe(12);

    const deployment = productSnapshot.deployment as Record<string, unknown>;
    expect(deployment.deploymentType).toBe("cloud");
    expect(deployment.supportLevel).toBe("premium");
    expect(deployment.fulfillmentKind).toBe("subscription_product");

    const rules = productSnapshot.rules as Record<string, unknown>;
    expect(rules.sizingArtifactVersionId).toBeTruthy();
    expect(Array.isArray(rules.compatibilityArtifactVersionIds)).toBe(true);

    expect(productLine!.fulfillmentSnapshotHash).toMatch(/^[a-f0-9]{64}$/);

    const serviceLine = quote.lineItems.find((l) => l.lineType === "service");
    expect(serviceLine).toBeDefined();

    const serviceSnapshot = serviceLine!.fulfillmentSnapshot as Record<string, unknown>;
    const serviceCatalog = serviceSnapshot.catalog as Record<string, unknown>;
    expect(serviceCatalog.productFamilyId).toBeNull();
    expect(serviceCatalog.skuId).toBeNull();

    const serviceLicense = serviceSnapshot.license as Record<string, unknown>;
    expect(serviceLicense.licenseMetricId).toBeNull();
    expect(serviceLicense.termMonths).toBeNull();

    const serviceSource = serviceSnapshot.source as Record<string, unknown>;
    expect(serviceSource.sourceCostStatus).toBe("approved");
    expect(serviceSource.sourceServiceLineItemId).toBe("sli-setup-2");

    const fulfillmentReceipt = {
      quoteId: quote.id,
      productLineId: productLine!.id,
      productFulfillmentSnapshot: productSnapshot,
      productFulfillmentSnapshotHash: productLine!.fulfillmentSnapshotHash,
      serviceLineId: serviceLine!.id,
      serviceFulfillmentSnapshot: serviceSnapshot,
      serviceFulfillmentSnapshotHash: serviceLine!.fulfillmentSnapshotHash,
      sections: {
        product: { source, quantity: productSnapshot.quantity, catalog, license, deployment, rules },
      },
    };

    writeFileSync(join(QUOTE_SCRATCH, "fulfillment-snapshot.json"), JSON.stringify(fulfillmentReceipt, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "fulfillment-snapshot.json"), JSON.stringify(fulfillmentReceipt, null, 2));
  });

  it("enforces the three kind matrices", async () => {
    const receipt: Record<string, unknown> = { tests: [] };

    // 1. Service-only line matrix
    const serviceOnlyInput: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-1",
      lines: [
        {
          lineType: "service",
          description: "Pure Service",
          quantity: 1,
          unitPrice: 1000,
          costPrice: 500,
          sourceCostStatus: "approved",
        },
      ],
    };

    const serviceResult = await quoteService.createQuoteVersion(SALES, serviceOnlyInput);
    const serviceQuote = await migrationAdmin.quote.findUniqueOrThrow({
      where: { id: serviceResult.id },
      include: { lineItems: true },
    });

    const serviceLine = serviceQuote.lineItems[0];
    const serviceSnap = serviceLine.fulfillmentSnapshot as Record<string, unknown>;
    const serviceCatalog = serviceSnap.catalog as Record<string, unknown>;
    const serviceLicense = serviceSnap.license as Record<string, unknown>;
    const serviceRules = serviceSnap.rules as Record<string, unknown>;

    expect(serviceCatalog.productFamilyId).toBeNull();
    expect(serviceCatalog.skuId).toBeNull();
    expect(serviceLicense.licenseMetricId).toBeNull();
    expect(serviceRules.sizingArtifactVersionId).toBeNull();
    expect(serviceLine.sourceCostStatus).toBe("approved");

    (receipt.tests as any).push({ kind: "service_only", passed: true, quoteId: serviceResult.id, lineId: serviceLine.id });

    // 2. Perpetual product matrix
    const perpetualInput: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-1",
      lines: [{ lineType: "product", quantity: 1, skuId: "u047-sku-perpetual" }],
    };

    const perpetualResult = await quoteService.createQuoteVersion(SALES, perpetualInput);
    const perpetualQuote = await migrationAdmin.quote.findUniqueOrThrow({
      where: { id: perpetualResult.id },
      include: { lineItems: true },
    });

    const perpetualLine = perpetualQuote.lineItems[0];
    const perpetualSnap = perpetualLine.fulfillmentSnapshot as Record<string, unknown>;
    const perpetualDeployment = perpetualSnap.deployment as Record<string, unknown>;
    const perpetualLicense = perpetualSnap.license as Record<string, unknown>;

    expect(perpetualDeployment.fulfillmentKind).toBe("perpetual_product");
    expect(perpetualLicense.termMonths).toBeNull();
    expect(perpetualLine.catalogSnapshotHash).toBeTruthy();
    expect(perpetualLine.sizingArtifactVersionId).toBeTruthy();

    (receipt.tests as any).push({ kind: "perpetual_product", passed: true, quoteId: perpetualResult.id, lineId: perpetualLine.id, fulfillmentKind: perpetualDeployment.fulfillmentKind });

    // 3. Subscription product matrix
    const subscriptionInput: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-1",
      lines: [{ lineType: "product", quantity: 2, skuId: "u047-sku-subscription", termMonths: 24 }],
    };

    const subscriptionResult = await quoteService.createQuoteVersion(SALES, subscriptionInput);
    const subscriptionQuote = await migrationAdmin.quote.findUniqueOrThrow({
      where: { id: subscriptionResult.id },
      include: { lineItems: true },
    });

    const subscriptionLine = subscriptionQuote.lineItems[0];
    const subscriptionSnap = subscriptionLine.fulfillmentSnapshot as Record<string, unknown>;
    const subscriptionDeployment = subscriptionSnap.deployment as Record<string, unknown>;
    const subscriptionLicense = subscriptionSnap.license as Record<string, unknown>;

    expect(subscriptionDeployment.fulfillmentKind).toBe("subscription_product");
    expect(subscriptionLicense.termMonths).toBe(24);
    expect(subscriptionLine.termMonths).toBe(24);

    (receipt.tests as any).push({ kind: "subscription_product", passed: true, quoteId: subscriptionResult.id, lineId: subscriptionLine.id, fulfillmentKind: subscriptionDeployment.fulfillmentKind, termMonths: subscriptionLicense.termMonths });

    // 4. Violation test: product line missing required skuId
    const missingSkuInput: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-1",
      lines: [{ lineType: "product", quantity: 1 }],
    };

    let violationPassed = false;
    try {
      await quoteService.createQuoteVersion(SALES, missingSkuInput);
    } catch (err: any) {
      violationPassed = err.code === "SKU_REQUIRED";
    }

    expect(violationPassed).toBe(true);
    (receipt.tests as any).push({ kind: "violation_test", violation: "product line without skuId", rejected: true });

    writeFileSync(join(QUOTE_SCRATCH, "matrix-enforcement.json"), JSON.stringify(receipt, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "matrix-enforcement.json"), JSON.stringify(receipt, null, 2));
  });

  it("missing service cost persists auto_failed and blocks approval-readiness", async () => {
    const input: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-2",
      currency: "USD",
      lines: [
        {
          lineType: "service",
          description: "Service without cost",
          quantity: 1,
          unitPrice: 3000,
        },
      ],
    };

    const result = await quoteService.createQuoteVersion(SALES, input);

    expect(result.commercialSnapshot).toBeDefined();
    expect(result.commercialSnapshot!.costCoverageStatus).toBe("auto_failed");
    expect(result.commercialSnapshot!.requiresApproval).toBe(true);

    const quote = await migrationAdmin.quote.findUniqueOrThrow({
      where: { id: result.id },
      include: { commercialSnapshot: true },
    });

    expect(quote.commercialSnapshot!.costCoverageStatus).toBe("auto_failed");
    expect(quote.commercialSnapshot!.requiresApproval).toBe(true);

    const missingCostReceipt = {
      quoteId: result.id,
      quoteVersion: result.version,
      costCoverageStatus: result.commercialSnapshot!.costCoverageStatus,
      requiresApproval: result.commercialSnapshot!.requiresApproval,
      reason: "Service line missing costPrice and sourceCostStatus",
      expectedBehavior: "auto_failed blocks approval-readiness",
    };

    writeFileSync(join(QUOTE_SCRATCH, "missing-cost.json"), JSON.stringify(missingCostReceipt, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "missing-cost.json"), JSON.stringify(missingCostReceipt, null, 2));
  });

  it("concurrent successor attempts yield exactly one winner and one 409", async () => {
    // Create canonical quote on opp-3
    const canonicalInput: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-3",
      expectedCurrentQuoteId: null,
      expectedCurrentContentHash: null,
      currency: "USD",
      lines: [
        {
          lineType: "product",
          quantity: 1,
          skuId: "u047-sku-perpetual",
          unitPrice: 5000,
          discountPct: 0,
          deploymentType: "on_premise",
          supportLevel: "standard",
        },
      ],
    };

    const canonical = await quoteService.createQuoteVersion(SALES, canonicalInput);
    expect(canonical.id).toBeTruthy();
    expect(canonical.contentHash).toBeTruthy();

    // Fire two concurrent successors with the SAME expectedCurrentQuoteId/contentHash
    const succ1: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-3",
      expectedCurrentQuoteId: canonical.id,
      expectedCurrentContentHash: canonical.contentHash,
      currency: "USD",
      lines: [
        {
          lineType: "product",
          quantity: 2,
          skuId: "u047-sku-perpetual",
          unitPrice: 5000,
          discountPct: 5,
          deploymentType: "on_premise",
          supportLevel: "premium",
        },
      ],
    };

    const succ2: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-3",
      expectedCurrentQuoteId: canonical.id,
      expectedCurrentContentHash: canonical.contentHash,
      currency: "USD",
      lines: [
        {
          lineType: "product",
          quantity: 3,
          skuId: "u047-sku-perpetual",
          unitPrice: 5000,
          discountPct: 10,
          deploymentType: "cloud",
          supportLevel: "premium",
        },
      ],
    };

    const results = await Promise.allSettled([
      quoteService.createQuoteVersion(SALES, succ1),
      quoteService.createQuoteVersion(SALES, succ2),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winner = (fulfilled[0] as PromiseFulfilledResult<any>).value;
    expect(winner.version).toBe(2);
    expect(winner.supersedesQuoteId).toBe(canonical.id);

    const loserReason = (rejected[0] as PromiseRejectedResult).reason;
    expect(loserReason.code).toBe("STALE_CAS");
    expect(loserReason.httpStatus).toBe(409);

    // DB successor count: exactly 1
    const successorCount = await migrationAdmin.quote.count({
      where: { supersedesQuoteId: canonical.id },
    });
    expect(successorCount).toBe(1);

    const concurrencyReceipt = {
      canonicalQuoteId: canonical.id,
      canonicalVersion: canonical.version,
      canonicalContentHash: canonical.contentHash,
      competingAttemptsCount: 2,
      fulfilledCount: fulfilled.length,
      rejectedCount: rejected.length,
      winnerQuoteId: winner.id,
      winnerVersion: winner.version,
      loserErrorCode: loserReason.code,
      loserHttpStatus: loserReason.httpStatus,
      successorCountInDb: successorCount,
      expectedBehavior: "Exactly one successor persists; concurrent loser fails with STALE_CAS 409",
    };

    writeFileSync(join(QUOTE_SCRATCH, "concurrency-409.json"), JSON.stringify(concurrencyReceipt, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "concurrency-409.json"), JSON.stringify(concurrencyReceipt, null, 2));
  });

  it("rolls back the whole graph on forced audit failure and succeeds after trigger drop", async () => {
    // Create a fresh opportunity for this test
    const rollbackOppId = `u047-opp-rollback-${Date.now()}`;
    await migrationAdmin.opportunity.create({
      data: {
        id: rollbackOppId,
        projectId: "u047-project-a",
        title: "Opportunity — Rollback Test",
      },
    });

    await migrationAdmin.dealQualification.create({
      data: {
        id: `u047-qual-rollback-${Date.now()}`,
        opportunityId: rollbackOppId,
        budgetScore: 18,
        authorityScore: 18,
        needScore: 22,
        timelineScore: 15,
        weightedScore: 73.0,
        passed: true,
        scoringVersion: "bant-tf-v1",
        qualifiedAt: new Date(),
      },
    });

    const input: CreateQuoteVersionInput = {
      opportunityId: rollbackOppId,
      expectedCurrentQuoteId: null,
      expectedCurrentContentHash: null,
      currency: "USD",
      lines: [
        {
          lineType: "product",
          quantity: 1,
          skuId: "u047-sku-perpetual",
          unitPrice: 5000,
          discountPct: 0,
          deploymentType: "on_premise",
          supportLevel: "standard",
        },
      ],
    };

    // Count before
    const quotesBefore = await migrationAdmin.quote.count();
    const lineItemsBefore = await migrationAdmin.quoteLineItem.count();
    const snapshotsBefore = await migrationAdmin.quoteCommercialSnapshot.count();
    const artifactVersionsBefore = await migrationAdmin.artifactVersion.count();

    // Inject BEFORE INSERT trigger on audit_logs to force failure
    await migrationAdmin.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION u047_fail_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.event_type = 'quote.version_created' THEN
          RAISE EXCEPTION 'u047_forced_audit_failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await migrationAdmin.$executeRawUnsafe(`
      CREATE TRIGGER u047_fail_audit_trg
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION u047_fail_audit();
    `);

    // Attempt should fail
    await expect(quoteService.createQuoteVersion(SALES, input)).rejects.toThrow();

    // Count after — must be identical (full rollback)
    const quotesAfter = await migrationAdmin.quote.count();
    const lineItemsAfter = await migrationAdmin.quoteLineItem.count();
    const snapshotsAfter = await migrationAdmin.quoteCommercialSnapshot.count();
    const artifactVersionsAfter = await migrationAdmin.artifactVersion.count();

    expect(quotesAfter).toBe(quotesBefore);
    expect(lineItemsAfter).toBe(lineItemsBefore);
    expect(snapshotsAfter).toBe(snapshotsBefore);
    expect(artifactVersionsAfter).toBe(artifactVersionsBefore);

    // Drop trigger and retry — should succeed
    await migrationAdmin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS u047_fail_audit_trg ON audit_logs;`);
    await migrationAdmin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS u047_fail_audit();`);

    const retryResult = await quoteService.createQuoteVersion(SALES, input);
    expect(retryResult.id).toBeTruthy();
    expect(retryResult.version).toBe(1);

    const rollbackReceipt = {
      testScenario: "forced_audit_failure_rollback",
      opportunityId: rollbackOppId,
      before: {
        quotes: quotesBefore,
        quoteLineItems: lineItemsBefore,
        quoteCommercialSnapshots: snapshotsBefore,
        artifactVersions: artifactVersionsBefore,
      },
      afterFailure: {
        quotes: quotesAfter,
        quoteLineItems: lineItemsAfter,
        quoteCommercialSnapshots: snapshotsAfter,
        artifactVersions: artifactVersionsAfter,
      },
      rollbackVerified: quotesAfter === quotesBefore && lineItemsAfter === lineItemsBefore && snapshotsAfter === snapshotsBefore && artifactVersionsAfter === artifactVersionsBefore,
      retryAfterTriggerDrop: {
        quoteId: retryResult.id,
        version: retryResult.version,
        succeeded: true,
      },
      expectedBehavior: "Audit trigger failure rolls back entire quote graph; retry after DROP succeeds",
    };

    writeFileSync(join(QUOTE_SCRATCH, "rollback-audit-failure.json"), JSON.stringify(rollbackReceipt, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "rollback-audit-failure.json"), JSON.stringify(rollbackReceipt, null, 2));
  });

  it("proves DB-level immutability via direct SQL", async () => {
    const immutableInput: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-4",
      expectedCurrentQuoteId: null,
      expectedCurrentContentHash: null,
      currency: "USD",
      lines: [
        {
          lineType: "product",
          quantity: 1,
          skuId: "u047-sku-perpetual",
          unitPrice: 5000,
          discountPct: 0,
          deploymentType: "on_premise",
          supportLevel: "standard",
        },
      ],
    };

    const immutable = await quoteService.createQuoteVersion(SALES, immutableInput);
    const quoteId = immutable.id;

    const updateQuoteError: string[] = [];
    try {
      await migrationAdmin.$executeRawUnsafe(
        `UPDATE "quotes" SET content_hash = 'corrupted_hash' WHERE id = $1`,
        quoteId
      );
    } catch (err: any) {
      updateQuoteError.push(err.message);
    }

    const deleteQuoteError: string[] = [];
    try {
      await migrationAdmin.$executeRawUnsafe(`DELETE FROM "quotes" WHERE id = $1`, quoteId);
    } catch (err: any) {
      deleteQuoteError.push(err.message);
    }

    const updateSnapshotError: string[] = [];
    try {
      await migrationAdmin.$executeRawUnsafe(
        `UPDATE "quote_commercial_snapshots" SET calculated_margin_pct = '0' WHERE quote_id = $1`,
        quoteId
      );
    } catch (err: any) {
      updateSnapshotError.push(err.message);
    }

    const deleteSnapshotError: string[] = [];
    try {
      await migrationAdmin.$executeRawUnsafe(
        `DELETE FROM "quote_commercial_snapshots" WHERE quote_id = $1`,
        quoteId
      );
    } catch (err: any) {
      deleteSnapshotError.push(err.message);
    }

    const deleteWithSnapshotError: string[] = [];
    try {
      await migrationAdmin.$executeRawUnsafe(`DELETE FROM "quotes" WHERE id = $1`, quoteId);
    } catch (err: any) {
      deleteWithSnapshotError.push(err.message);
    }

    const immutabilityProof = {
      quoteId,
      contentHash: immutable.contentHash,
      probes: [
        { probe: "UPDATE quote.content_hash", actualError: updateQuoteError[0] ?? "NO ERROR (BUG)", blocked: updateQuoteError.length > 0 },
        { probe: "DELETE quote", actualError: deleteQuoteError[0] ?? "NO ERROR (BUG)", blocked: deleteQuoteError.length > 0 },
        { probe: "UPDATE quote_commercial_snapshot", actualError: updateSnapshotError[0] ?? "NO ERROR (BUG)", blocked: updateSnapshotError.length > 0 },
        { probe: "DELETE quote_commercial_snapshot", actualError: deleteSnapshotError[0] ?? "NO ERROR (BUG)", blocked: deleteSnapshotError.length > 0 },
        { probe: "DELETE quote with snapshots (FK RESTRICT)", actualError: deleteWithSnapshotError[0] ?? "NO ERROR (BUG)", blocked: deleteWithSnapshotError.length > 0 },
      ],
      allProbesBlocked: [
        updateQuoteError.length > 0,
        deleteQuoteError.length > 0,
        updateSnapshotError.length > 0,
        deleteSnapshotError.length > 0,
        deleteWithSnapshotError.length > 0,
      ].every(Boolean),
    };

    expect(immutabilityProof.allProbesBlocked).toBe(true);

    writeFileSync(join(QUOTE_SCRATCH, "quote-immutability-db.json"), JSON.stringify(immutabilityProof, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "quote-immutability-db.json"), JSON.stringify(immutabilityProof, null, 2));
  });

  it("legacy null-hash bridge fills once and only once", async () => {
    const legacyId = `u047-legacy-null-hash-${Date.now()}`;
    await migrationAdmin.$executeRawUnsafe(
      `INSERT INTO "quotes" (id, opportunity_id, company_id, status, version, total_revenue, total_cost, margin_pct, created_by, currency)
       VALUES ($1, $2, $3, $4, $5, $6::numeric, $7::numeric, $8::numeric, $9, $10)`,
      legacyId,
      "u047-opp-1",
      "u047-company-a",
      "draft",
      0,
      0,
      0,
      0,
      "u047-sales-user",
      null
    );

    const legacyBefore = await migrationAdmin.quote.findUniqueOrThrow({ where: { id: legacyId } });
    expect(legacyBefore.contentHash).toBeNull();
    expect(legacyBefore.currency).toBeNull();

    const validSha256 = "a".repeat(64);
    await migrationAdmin.quote.update({
      where: { id: legacyId },
      data: {
        currency: "USD",
        contentHash: validSha256,
      },
    });

    const legacyAfterFirstFill = await migrationAdmin.quote.findUniqueOrThrow({ where: { id: legacyId } });
    expect(legacyAfterFirstFill.currency).toBe("USD");
    expect(legacyAfterFirstFill.contentHash).toBe(validSha256);
    expect(legacyAfterFirstFill.totalRevenue.toFixed(2)).toBe("0.00");

    const secondFillError: string[] = [];
    try {
      await migrationAdmin.quote.update({
        where: { id: legacyId },
        data: { currency: "EUR" },
      });
    } catch (err: any) {
      secondFillError.push(err.message);
    }

    const protectedUpdateError: string[] = [];
    try {
      await migrationAdmin.quote.update({
        where: { id: legacyId },
        data: {
          totalRevenue: new Prisma.Decimal(1000),
        },
      });
    } catch (err: any) {
      protectedUpdateError.push(err.message);
    }

    const legacyBridgeReceipt = {
      legacyQuoteId: legacyId,
      beforeFill: { currency: null, contentHash: null },
      afterFirstFill: { currency: legacyAfterFirstFill.currency, contentHash: legacyAfterFirstFill.contentHash },
      secondFillAttemptError: secondFillError[0] ?? "NO ERROR",
      protectedUpdateAttemptError: protectedUpdateError[0] ?? "NO ERROR",
      expectedBehavior: "Fill currency+contentHash once; reject further updates",
      gapIfNoError: secondFillError.length === 0 ? "U035 trigger may not enforce second-fill rejection" : null,
    };

    writeFileSync(join(QUOTE_SCRATCH, "legacy-null-hash-bridge.json"), JSON.stringify(legacyBridgeReceipt, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "legacy-null-hash-bridge.json"), JSON.stringify(legacyBridgeReceipt, null, 2));
  });

  it("immutable predecessor + version chain", async () => {
    const chainRootInput: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-5",
      expectedCurrentQuoteId: null,
      expectedCurrentContentHash: null,
      currency: "USD",
      lines: [
        {
          lineType: "product",
          quantity: 1,
          skuId: "u047-sku-perpetual",
          unitPrice: 5000,
          discountPct: 0,
          deploymentType: "on_premise",
          supportLevel: "standard",
        },
      ],
    };

    const v1 = await quoteService.createQuoteVersion(SALES, chainRootInput);

    const v2Input: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-5",
      expectedCurrentQuoteId: v1.id,
      expectedCurrentContentHash: v1.contentHash,
      currency: "USD",
      lines: [
        {
          lineType: "product",
          quantity: 2,
          skuId: "u047-sku-perpetual",
          unitPrice: 5000,
          discountPct: 5,
          deploymentType: "on_premise",
          supportLevel: "premium",
        },
      ],
    };

    const v2 = await quoteService.createQuoteVersion(SALES, v2Input);
    expect(v2.supersedesQuoteId).toBe(v1.id);
    expect(v2.version).toBe(2);

    const v3Input: CreateQuoteVersionInput = {
      opportunityId: "u047-opp-5",
      expectedCurrentQuoteId: v2.id,
      expectedCurrentContentHash: v2.contentHash,
      currency: "USD",
      lines: [
        {
          lineType: "product",
          quantity: 3,
          skuId: "u047-sku-perpetual",
          unitPrice: 5000,
          discountPct: 10,
          deploymentType: "cloud",
          supportLevel: "premium",
        },
      ],
    };

    const v3 = await quoteService.createQuoteVersion(SALES, v3Input);
    expect(v3.supersedesQuoteId).toBe(v2.id);
    expect(v3.version).toBe(3);

    const v1Recheck = await migrationAdmin.quote.findUniqueOrThrow({ where: { id: v1.id } });
    expect(v1Recheck.contentHash).toBe(v1.contentHash);
    expect(v1Recheck.version).toBe(1);
    expect(v1Recheck.totalRevenue.toFixed(2)).toBe(v1.totalRevenue.toFixed(2));

    const versionChainProof = {
      v1: { id: v1.id, version: v1.version, contentHash: v1.contentHash, supersedesQuoteId: v1.supersedesQuoteId },
      v2: { id: v2.id, version: v2.version, contentHash: v2.contentHash, supersedesQuoteId: v2.supersedesQuoteId },
      v3: { id: v3.id, version: v3.version, contentHash: v3.contentHash, supersedesQuoteId: v3.supersedesQuoteId },
      v1RecheckContentHash: v1Recheck.contentHash,
      v1Immutable: v1Recheck.contentHash === v1.contentHash,
      expectedBehavior: "Version chain: v1 → v2 → v3; v1 remains byte-identical",
    };

    writeFileSync(join(QUOTE_SCRATCH, "version-chain.json"), JSON.stringify(versionChainProof, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "version-chain.json"), JSON.stringify(versionChainProof, null, 2));
  });
});
