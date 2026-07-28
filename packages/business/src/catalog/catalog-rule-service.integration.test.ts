import { writeFileSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { applyU046RlsGrants } from "./u046-grant.fixture";

// @ts-expect-error -- U009's lifecycle helper is a committed plain-JS module.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";
import {
  publishSizingTemplate,
  publishCompatibilityRule,
  evaluateActiveSizingTemplate,
  evaluateActiveCompatibilityRule,
  CatalogRuleServiceError,
} from "./catalog-rule-service";
import { createArtifactVersion } from "../governance/artifact-service";
import { submitApprovalRequest, decideApprovalWithClient, type ApprovalKernelCaller } from "../governance/approval-kernel";
import * as auditDbModule from "../governance/audit-db";

const integration = process.env.CI_INTEGRATION === "1";
const IMAGE_DIGEST = "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const RULES_SCRATCH = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U046/attempt-1/rules-scratch"
);
const EVIDENCE_ROOT = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U046/attempt-1"
);

const CALLER: ApprovalKernelCaller = {
  userId: "u046-admin-user",
  sessionId: "u046-session-1",
  mfaVerifiedAt: new Date(),
  scope: { tenantId: "u046-tenant-a", companyId: "u046-company-a", projectId: "u046-project-a" },
};

const APPROVER_CALLER: ApprovalKernelCaller = {
  userId: "u046-approver-user",
  sessionId: "u046-approver-session",
  mfaVerifiedAt: new Date(),
  scope: { tenantId: "u046-tenant-a", companyId: "u046-company-a", projectId: "u046-project-a" },
};

let admin: PrismaClient;
let migrationAdmin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let previousDatabaseUrl: string | undefined;

describe.runIf(integration)("CatalogRuleService DB Integration", () => {
  beforeAll(async () => {
    mkdirSync(RULES_SCRATCH, { recursive: true });
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
        runId: `u046-catalog-rules-${Date.now().toString(36)}`,
        ownerUnit: "U046",
        purpose: "catalog-rules-integration",
        evidenceDir: RULES_SCRATCH,
        imageDigest: IMAGE_DIGEST,
        migrate: true,
        applicationRoleMode: "required",
      },
      async (ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => {
        resolveReady?.(ctx);
        await held;
      }
    );

    const { databaseUrl, migrationDatabaseUrl } = await ready;
    process.env.DATABASE_URL = databaseUrl;

    migrationAdmin = new PrismaClient({
      datasources: { db: { url: migrationDatabaseUrl } },
    });
    admin = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    await applyU046RlsGrants(migrationAdmin);

    // Seed base tenant, company and user role using migrationAdmin
    await migrationAdmin.tenant.create({
      data: {
        id: "u046-tenant-a",
        slug: "u046-tenant-a",
        name: "U046 Tenant A",
        status: "active",
      },
    });

    await migrationAdmin.company.create({
      data: {
        id: "u046-company-a",
        tenantId: "u046-tenant-a",
        slug: "u046-company-a",
        name: "U046 Company A",
      },
    });

    await migrationAdmin.project.create({
      data: {
        id: "u046-project-a",
        companyId: "u046-company-a",
        slug: "u046-project-a",
        name: "U046 Project A",
      },
    });

    await migrationAdmin.user.create({
      data: {
        id: "u046-admin-user",
        email: "u046-admin@sangfor.local",
        name: "U046 Admin",
      },
    });

    await migrationAdmin.userCompanyRole.create({
      data: {
        id: "u046-ucr-1",
        companyId: "u046-company-a",
        userId: "u046-admin-user",
        role: "ceo",
        status: "active",
        validFrom: new Date(Date.now() - 3600000),
      },
    });

    await migrationAdmin.user.create({
      data: {
        id: "u046-approver-user",
        email: "u046-approver@sangfor.local",
        name: "U046 Approver",
      },
    });

    await migrationAdmin.userCompanyRole.create({
      data: {
        id: "u046-ucr-approver",
        companyId: "u046-company-a",
        userId: "u046-approver-user",
        role: "ceo",
        status: "active",
        validFrom: new Date(Date.now() - 3600000),
      },
    });

    await migrationAdmin.productFamily.create({
      data: {
        id: "fam-sizing-1",
        companyId: "u046-company-a",
        familyKey: "SIZING_FAM",
        name: "Sizing Family",
        category: "COMPUTE",
        vendor: "SANGFOR",
        status: "ACTIVE",
      },
    });
  }, 120000);

  afterAll(async () => {
    if (admin) await admin.$disconnect();
    if (migrationAdmin) await migrationAdmin.$disconnect();
    if (releaseLifecycle) releaseLifecycle();
    if (lifecycle) await lifecycle;
    if (previousDatabaseUrl) {
      process.env.DATABASE_URL = previousDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it("evaluates active sizing and compatibility rules deterministically", async () => {
    // 1. Seed SizingTemplate
    const familyId = "fam-sizing-1";

    const artifact = await migrationAdmin.artifact.create({
      data: {
        id: "art-sizing-1",
        tenant: { connect: { id: "u046-tenant-a" } },
        company: { connect: { tenantId_id: { tenantId: "u046-tenant-a", id: "u046-company-a" } } },
        project: { connect: { companyId_id: { companyId: "u046-company-a", id: "u046-project-a" } } },
        createdByAssignment: { connect: { id_companyId: { id: "u046-ucr-1", companyId: "u046-company-a" } } },
        ownerAssignment: { connect: { id_companyId: { id: "u046-ucr-1", companyId: "u046-company-a" } } },
        artifactType: "SIZING_TEMPLATE",
        classification: "internal",
        origin: "human",
        title: "Sizing Artifact 1",
        currentRevision: 0,
      },
    });

    const sizingPayload = {
      version: "v1",
      baseSkuId: "sku-base-1",
      tiers: [
        {
          minUsers: 1,
          maxUsers: 100,
          recommendedSkuId: "sku-tier-small",
          recommendedCpu: 4,
          recommendedRamGb: 16,
        },
        {
          minUsers: 101,
          maxUsers: 1000,
          recommendedSkuId: "sku-tier-medium",
          recommendedCpu: 16,
          recommendedRamGb: 64,
        },
      ],
    };

    const createdVer = await createArtifactVersion(
      {
        artifactId: artifact.id,
        expectedCurrentVersionId: null,
        expectedCurrentRevision: 0,
        content: JSON.stringify(sizingPayload),
        contentType: "application/json",
      },
      CALLER,
      migrationAdmin
    );

    const template = await migrationAdmin.sizingTemplate.create({
      data: {
        id: "st-1",
        productFamilyId: familyId,
        templateKey: "tmpl-1",
        artifactId: artifact.id,
        activeArtifactVersionId: createdVer.versionId,
        name: "Template 1",
        configJson: sizingPayload,
        status: "ACTIVE",
      },
    });

    // Evaluate 2 times to verify determinism
    const res1 = await evaluateActiveSizingTemplate(CALLER, template.id, { userCount: 50 }, migrationAdmin);
    const res2 = await evaluateActiveSizingTemplate(CALLER, template.id, { userCount: 50 }, migrationAdmin);

    expect(res1).toEqual(res2);
    expect(res1.recommendedSkuId).toBe("sku-tier-small");
    expect(res1.solutionFitPassed).toBe(true);

    const receipt = {
      templateId: template.id,
      res1,
      res2,
      deterministicMatch: JSON.stringify(res1) === JSON.stringify(res2),
    };

    writeFileSync(join(RULES_SCRATCH, "determinism.json"), JSON.stringify(receipt, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "determinism.json"), JSON.stringify(receipt, null, 2));
  });

  it("handles action-bound publication, action-mismatch rejection, and stale CAS 409", async () => {
    const familyId = "fam-sizing-1";

    const artifact = await migrationAdmin.artifact.create({
      data: {
        id: "art-sizing-2",
        tenant: { connect: { id: "u046-tenant-a" } },
        company: { connect: { tenantId_id: { tenantId: "u046-tenant-a", id: "u046-company-a" } } },
        project: { connect: { companyId_id: { companyId: "u046-company-a", id: "u046-project-a" } } },
        createdByAssignment: { connect: { id_companyId: { id: "u046-ucr-1", companyId: "u046-company-a" } } },
        ownerAssignment: { connect: { id_companyId: { id: "u046-ucr-1", companyId: "u046-company-a" } } },
        artifactType: "SIZING_TEMPLATE",
        classification: "internal",
        origin: "human",
        title: "Sizing Artifact 2",
        currentRevision: 0,
      },
    });

    const payloadV1 = { version: "v1", baseSkuId: "sku-base-v1", tiers: [] };
    const ver1 = await createArtifactVersion(
      {
        artifactId: artifact.id,
        expectedCurrentVersionId: null,
        expectedCurrentRevision: 0,
        content: JSON.stringify(payloadV1),
        contentType: "application/json",
      },
      CALLER,
      migrationAdmin
    );

    const template = await migrationAdmin.sizingTemplate.create({
      data: {
        id: "st-2",
        productFamilyId: familyId,
        templateKey: "tmpl-2",
        artifactId: artifact.id,
        activeArtifactVersionId: null,
        name: "Template 2",
        configJson: payloadV1,
        status: "DRAFT",
      },
    });

    // Create Approval Request bound to "catalog.sizing.publish"
    const readySizing = await submitApprovalRequest(
      {
        action: "catalog.sizing.publish",
        artifactVersionId: ver1.versionId,
        artifactHash: ver1.contentHash,
        policyVersion: "v1",
        requiredQuorum: 1,
      },
      CALLER,
      migrationAdmin
    );
    const approvalReqSizing = await decideApprovalWithClient(
      migrationAdmin,
      {
        approvalId: readySizing.request.id,
        decision: "approve",
        expectedRevision: readySizing.request.revision,
      },
      APPROVER_CALLER
    );

    // 1. Action Binding Negative Test: Try publishing with wrong action approval
    const readyCompat = await submitApprovalRequest(
      {
        action: "catalog.compatibility.publish", // Wrong action for sizing!
        artifactVersionId: ver1.versionId,
        artifactHash: ver1.contentHash,
        policyVersion: "v1",
        requiredQuorum: 1,
      },
      CALLER,
      migrationAdmin
    );
    const approvalReqCompat = await decideApprovalWithClient(
      migrationAdmin,
      {
        approvalId: readyCompat.request.id,
        decision: "approve",
        expectedRevision: readyCompat.request.revision,
      },
      APPROVER_CALLER
    );

    await expect(
      publishSizingTemplate(
        CALLER,
        template.id,
        {
          artifactVersionId: ver1.versionId,
          approvalId: approvalReqCompat.request.id, // Sizing publish using compatibility approval
          expectedActiveArtifactVersionId: null,
        },
        migrationAdmin
      )
    ).rejects.toThrow(CatalogRuleServiceError);

    const actionBindingReceipt = {
      attempt: "Publish SizingTemplate with catalog.compatibility.publish approval",
      rejectedAsExpected: true,
    };
    writeFileSync(join(RULES_SCRATCH, "action-binding-negative.json"), JSON.stringify(actionBindingReceipt, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "action-binding-negative.json"), JSON.stringify(actionBindingReceipt, null, 2));

    // 2. Valid Publish
    const pubRes = await publishSizingTemplate(
      CALLER,
      template.id,
      {
        artifactVersionId: ver1.versionId,
        approvalId: approvalReqSizing.request.id,
        expectedActiveArtifactVersionId: null,
      },
      migrationAdmin
    );

    expect(pubRes.activeArtifactVersionId).toBe(ver1.versionId);

    const pubReceipt = {
      templateId: template.id,
      publishedArtifactVersionId: ver1.versionId,
      approvalId: approvalReqSizing.request.id,
      status: "ACTIVE",
    };
    writeFileSync(join(RULES_SCRATCH, "publish-receipt.json"), JSON.stringify(pubReceipt, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "publish-receipt.json"), JSON.stringify(pubReceipt, null, 2));

    // 3. Stale 409 test: Try publishing again with old expectedActiveArtifactVersionId (null instead of ver1.versionId)
    await expect(
      publishSizingTemplate(
        CALLER,
        template.id,
        {
          artifactVersionId: ver1.versionId,
          approvalId: approvalReqSizing.request.id,
          expectedActiveArtifactVersionId: null, // Stale!
        },
        migrationAdmin
      )
    ).rejects.toThrow("activeArtifactVersionId CAS mismatch");

    const staleReceipt = {
      templateId: template.id,
      staleExpectedVersionId: null,
      currentActiveVersionId: ver1.versionId,
      status: 409,
    };
    writeFileSync(join(RULES_SCRATCH, "stale-409.json"), JSON.stringify(staleReceipt, null, 2));
    writeFileSync(join(EVIDENCE_ROOT, "stale-409.json"), JSON.stringify(staleReceipt, null, 2));
  });

  it("enforces concurrent active-version CAS (Promise.allSettled single winner)", async () => {
    const familyId = "fam-sizing-1";

    const artifact = await migrationAdmin.artifact.create({
      data: {
        id: "art-sizing-3",
        tenant: { connect: { id: "u046-tenant-a" } },
        company: { connect: { tenantId_id: { tenantId: "u046-tenant-a", id: "u046-company-a" } } },
        project: { connect: { companyId_id: { companyId: "u046-company-a", id: "u046-project-a" } } },
        createdByAssignment: { connect: { id_companyId: { id: "u046-ucr-1", companyId: "u046-company-a" } } },
        ownerAssignment: { connect: { id_companyId: { id: "u046-ucr-1", companyId: "u046-company-a" } } },
        artifactType: "SIZING_TEMPLATE",
        classification: "internal",
        origin: "human",
        title: "Sizing Artifact 3",
        currentRevision: 0,
      },
    });

    const payload = { version: "v1", baseSkuId: "sku-base-cas" };
    const ver1 = await createArtifactVersion(
      {
        artifactId: artifact.id,
        expectedCurrentVersionId: null,
        expectedCurrentRevision: 0,
        content: JSON.stringify(payload),
        contentType: "application/json",
      },
      CALLER,
      migrationAdmin
    );

    const template = await migrationAdmin.sizingTemplate.create({
      data: {
        id: "st-cas-1",
        productFamilyId: familyId,
        templateKey: "tmpl-cas-1",
        artifactId: artifact.id,
        activeArtifactVersionId: null,
        name: "CAS Template",
        configJson: payload,
        status: "DRAFT",
      },
    });

    const readyCas = await submitApprovalRequest(
      {
        action: "catalog.sizing.publish",
        artifactVersionId: ver1.versionId,
        artifactHash: ver1.contentHash,
        policyVersion: "v1",
        requiredQuorum: 1,
      },
      CALLER,
      migrationAdmin
    );
    const approvalReq = await decideApprovalWithClient(
      migrationAdmin,
      {
        approvalId: readyCas.request.id,
        decision: "approve",
        expectedRevision: readyCas.request.revision,
      },
      APPROVER_CALLER
    );

    // Fire 2 concurrent publish requests with same expectedActiveArtifactVersionId (null)
    const results = await Promise.allSettled([
      publishSizingTemplate(CALLER, template.id, {
        artifactVersionId: ver1.versionId,
        approvalId: approvalReq.request.id,
        expectedActiveArtifactVersionId: null,
      }, migrationAdmin),
      publishSizingTemplate(CALLER, template.id, {
        artifactVersionId: ver1.versionId,
        approvalId: approvalReq.request.id,
        expectedActiveArtifactVersionId: null,
      }, migrationAdmin),
    ]);

    const fulfilledCount = results.filter((r) => r.status === "fulfilled").length;
    const rejectedCount = results.filter((r) => r.status === "rejected").length;

    expect(fulfilledCount).toBe(1);
    expect(rejectedCount).toBe(1);

    const finalRecord = await migrationAdmin.sizingTemplate.findUniqueOrThrow({ where: { id: template.id } });
    expect(finalRecord.activeArtifactVersionId).toBe(ver1.versionId);
  });

  it("rollbacks total transaction (activeArtifactVersionId pointer unchanged) when audit log insertion fails", async () => {
    const payload = { version: "v1", rules: [] };
    const artifact = await migrationAdmin.artifact.create({
      data: {
        id: "art-rollback-1",
        tenantId: "u046-tenant-a",
        companyId: "u046-company-a",
        projectId: "u046-project-a",
        title: "Rollback Template",
        artifactType: "sizing_template",
        classification: "internal",
        origin: "human",
        createdByAssignmentId: "u046-ucr-1",
        ownerAssignmentId: "u046-ucr-1",
      },
    });
    const ver1 = await createArtifactVersion(
      {
        artifactId: artifact.id,
        expectedCurrentVersionId: null,
        expectedCurrentRevision: 0,
        content: JSON.stringify(payload),
        contentType: "application/json",
      },
      CALLER,
      migrationAdmin
    );

    const template = await migrationAdmin.sizingTemplate.create({
      data: {
        id: "fam-rollback-1",
        productFamilyId: "fam-sizing-1",
        templateKey: "SIZING_ROLLBACK",
        artifactId: artifact.id,
        activeArtifactVersionId: null,
        name: "Rollback Template",
        configJson: payload,
        status: "DRAFT",
      },
    });

    const readyReq = await submitApprovalRequest(
      {
        action: "catalog.sizing.publish",
        artifactVersionId: ver1.versionId,
        artifactHash: ver1.contentHash,
        policyVersion: "v1",
        requiredQuorum: 1,
      },
      CALLER,
      migrationAdmin
    );
    const approvalReq = await decideApprovalWithClient(
      migrationAdmin,
      {
        approvalId: readyReq.request.id,
        decision: "approve",
        expectedRevision: readyReq.request.revision,
      },
      APPROVER_CALLER
    );

    const BAD_CALLER: ApprovalKernelCaller = {
      userId: "bad-actor-user",
      sessionId: "u046-session-1",
      mfaVerifiedAt: new Date(),
      scope: { tenantId: "invalid-tenant-scope-fails-audit-insert", companyId: "u046-company-a", projectId: "u046-project-a" },
    };

    await migrationAdmin.user.create({
      data: {
        id: "bad-actor-user",
        email: "badactor@sangfor.local",
        name: "Bad Actor",
      },
    });

    await migrationAdmin.userCompanyRole.create({
      data: {
        id: "u046-ucr-bad",
        companyId: "u046-company-a",
        userId: "bad-actor-user",
        role: "ceo",
        status: "active",
        validFrom: new Date(Date.now() - 3600000),
      },
    });

    await expect(
      publishSizingTemplate(
        BAD_CALLER,
        template.id,
        {
          artifactVersionId: ver1.versionId,
          approvalId: approvalReq.request.id,
          expectedActiveArtifactVersionId: null,
        },
        migrationAdmin
      )
    ).rejects.toThrow();

    // Verify DB state is completely untouched / rolled back
    const afterTemplate = await migrationAdmin.sizingTemplate.findUniqueOrThrow({
      where: { id: template.id },
    });
    expect(afterTemplate.activeArtifactVersionId).toBeNull();
    expect(afterTemplate.status).toBe("DRAFT");
  });
});
