import type { AuthContext } from "@sangfor/auth";
import { PrismaClient } from "@prisma/client";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { applyU043RlsGrants } from "./u043-grant.fixture";

// @ts-expect-error -- U009's lifecycle helper is a committed plain-JS module.
import { withIsolatedPostgres } from "../../../../scripts/lib/isolated-postgres.mjs";

const integration = process.env.CI_INTEGRATION === "1";
const IMAGE_DIGEST =
  "sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777";
const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const EVIDENCE_DIR = join(
  REPO_ROOT,
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U043/attempt-1/opportunity-scratch",
);
const VERSION = new Date("2026-07-24T00:00:00.000Z");

const SALES: AuthContext = {
  userId: "u043-opportunity-user-a",
  sessionId: "u043-opportunity-session-a",
  tenantId: "u043-opportunity-tenant-a",
  companyId: "u043-opportunity-company-a",
  projectId: "u043-opportunity-project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write"],
  product: "portal",
};

let admin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let previousDatabaseUrl: string | undefined;
let opportunityService: typeof import("./opportunity-center");
let engagementService: typeof import("./engagement-center");

async function seedScope(suffix: "a" | "b") {
  const tenantId = `u043-opportunity-tenant-${suffix}`;
  const companyId = `u043-opportunity-company-${suffix}`;
  const projectId = `u043-opportunity-project-${suffix}`;
  const userId = `u043-opportunity-user-${suffix}`;
  await admin.tenant.create({
    data: {
      id: tenantId,
      slug: tenantId,
      name: `Opportunity Tenant ${suffix}`,
      status: "active",
    },
  });
  await admin.company.create({
    data: {
      id: companyId,
      tenantId,
      slug: companyId,
      name: `Opportunity Company ${suffix}`,
    },
  });
  await admin.project.create({
    data: {
      id: projectId,
      companyId,
      slug: projectId,
      name: `Opportunity Project ${suffix}`,
    },
  });
  await admin.user.create({
    data: {
      id: userId,
      email: `${userId}@example.test`,
      name: `Opportunity User ${suffix}`,
      status: "active",
    },
  });
  await admin.userCompanyRole.create({
    data: {
      id: `u043-opportunity-assignment-${suffix}`,
      userId,
      companyId,
      role: "sales_manager",
      status: "active",
      validFrom: new Date("2026-07-23T00:00:00.000Z"),
    },
  });
  await admin.projectMember.create({
    data: {
      id: `u043-opportunity-member-${suffix}`,
      projectId,
      userId,
      role: "member",
      status: "active",
      validFrom: new Date("2026-07-23T00:00:00.000Z"),
    },
  });
}

describe.skipIf(!integration)("U043 canonical opportunity integration", () => {
  beforeAll(async () => {
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
        runId: `u043-opportunity-${Date.now().toString(36)}`,
        ownerUnit: "U043",
        purpose: "crm-opportunity-integration",
        evidenceDir: EVIDENCE_DIR,
        imageDigest: IMAGE_DIGEST,
        migrate: true,
        applicationRoleMode: "required",
      },
      async (ctx: { databaseUrl: string; migrationDatabaseUrl: string }) => {
        resolveReady?.(ctx);
        await held;
      },
    );

    const scratch = await ready;
    process.env.DATABASE_URL = scratch.migrationDatabaseUrl;
    process.env.SANGFOR_APP_DATABASE_URL = scratch.databaseUrl;
    process.env.CRM_CURSOR_SECRET =
      "u043-opportunity-cursor-secret-32-bytes-minimum";
    admin = new PrismaClient({
      datasources: { db: { url: scratch.migrationDatabaseUrl } },
    });
    await applyU043RlsGrants(admin);
    await seedScope("a");
    await seedScope("b");

    await admin.user.create({
      data: {
        id: "u043-opportunity-owner-user",
        email: "u043-opportunity-owner@example.test",
        name: "Eligible Owner",
        status: "active",
      },
    });
    await admin.userCompanyRole.create({
      data: {
        id: "u043-opportunity-owner-assignment",
        userId: "u043-opportunity-owner-user",
        companyId: SALES.companyId,
        role: "sales_manager",
        status: "active",
        validFrom: new Date("2026-07-23T00:00:00.000Z"),
      },
    });
    await admin.projectMember.create({
      data: {
        id: "u043-opportunity-owner-member",
        projectId: SALES.projectId,
        userId: "u043-opportunity-owner-user",
        status: "active",
        validFrom: new Date("2026-07-23T00:00:00.000Z"),
      },
    });
    await admin.customer.create({
      data: {
        id: "u043-opportunity-customer-a",
        projectId: SALES.projectId,
        name: "Opportunity Customer",
      },
    });
    await admin.opportunity.createMany({
      data: [
        {
          id: "u043-opportunity-a-1",
          projectId: SALES.projectId,
          customerId: "u043-opportunity-customer-a",
          title: "Scoped Opportunity 1",
          ownerAssignmentId: "u043-opportunity-assignment-a",
          updatedAt: VERSION,
        },
        {
          id: "u043-opportunity-a-2",
          projectId: SALES.projectId,
          customerId: "u043-opportunity-customer-a",
          title: "Scoped Opportunity 2",
          ownerAssignmentId: "u043-opportunity-assignment-a",
          updatedAt: VERSION,
        },
        {
          id: "u043-opportunity-a-3",
          projectId: SALES.projectId,
          customerId: "u043-opportunity-customer-a",
          title: "Scoped Opportunity 3",
          ownerAssignmentId: "u043-opportunity-assignment-a",
          updatedAt: VERSION,
        },
        {
          id: "u043-opportunity-b-sentinel",
          projectId: "u043-opportunity-project-b",
          title: "Foreign Opportunity Sentinel",
          ownerAssignmentId: "u043-opportunity-assignment-b",
          updatedAt: VERSION,
        },
      ],
    });
    const conversion = await admin.opportunity.create({
      data: {
        id: "u043-opportunity-conversion",
        projectId: SALES.projectId,
        customerId: "u043-opportunity-customer-a",
        title: "Conversion Opportunity",
        stage: "POC",
        ownerAssignmentId: "u043-opportunity-assignment-a",
        updatedAt: new Date(VERSION.getTime() - 1000),
      },
    });
    await admin.pocProject.create({
      data: {
        id: "u043-opportunity-poc",
        projectId: SALES.projectId,
        customerId: "u043-opportunity-customer-a",
        opportunityId: conversion.id,
        title: "Conversion PoC",
      },
    });

    vi.resetModules();
    opportunityService = await import("./opportunity-center");
    engagementService = await import("./engagement-center");
  }, 180_000);

  afterAll(async () => {
    await admin?.$disconnect();
    delete process.env.SANGFOR_APP_DATABASE_URL;
    delete process.env.CRM_CURSOR_SECRET;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    releaseLifecycle?.();
    await lifecycle;
  }, 60_000);

  it("keeps stable two-column cursor pages scoped under equal timestamps", async () => {
    const first = await opportunityService.listOpportunities(SALES, { first: 2 });
    expect(first.items.map((opportunity) => opportunity.id)).toEqual([
      "u043-opportunity-a-3",
      "u043-opportunity-a-2",
    ]);
    const second = await opportunityService.listOpportunities(SALES, {
      first: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((opportunity) => opportunity.id)).toContain(
      "u043-opportunity-a-1",
    );
    expect(
      [...first.items, ...second.items].some(
        (opportunity) => opportunity.id === "u043-opportunity-b-sentinel",
      ),
    ).toBe(false);
  });

  it("allows one owner revision winner and preserves immutable creator authority", async () => {
    const row = await admin.opportunity.create({
      data: {
        id: "u043-opportunity-owner-cas",
        projectId: SALES.projectId,
        title: "Owner CAS",
        ownerId: SALES.userId,
        ownerAssignmentId: "u043-opportunity-assignment-a",
        ownershipRevision: 0,
      },
    });
    const command = {
      ownerAssignmentId: "u043-opportunity-owner-assignment",
      expectedOwnershipRevision: 0,
    };
    const results = await Promise.allSettled([
      opportunityService.assignOpportunityOwner(SALES, row.id, {
        ...command,
        idempotencyKey: "owner-cas-a",
      }),
      opportunityService.assignOpportunityOwner(SALES, row.id, {
        ...command,
        idempotencyKey: "owner-cas-b",
      }),
    ]);

    if (!results.some((result) => result.status === "fulfilled")) {
      throw new Error(
        `owner CAS produced no winner: ${results
          .map((result) =>
            result.status === "rejected"
              ? result.reason instanceof Error
                ? result.reason.message
                : String(result.reason)
              : "fulfilled",
          )
          .join(" | ")}`,
      );
    }
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    const persisted = await admin.opportunity.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(persisted.ownerAssignmentId).toBe(
      "u043-opportunity-owner-assignment",
    );
    expect(persisted.ownershipRevision).toBe(1);
    expect(persisted.ownerId).toBe(SALES.userId);
    await expect(
      admin.auditLog.count({
        where: {
          projectId: SALES.projectId,
          eventType: "opportunity.owner_assigned",
          resourceId: row.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it("rejects a cross-company owner before any revision increment", async () => {
    const before = await admin.opportunity.findUniqueOrThrow({
      where: { id: "u043-opportunity-a-1" },
    });
    await expect(
      opportunityService.assignOpportunityOwner(
        SALES,
        "u043-opportunity-a-1",
        {
          ownerAssignmentId: "u043-opportunity-assignment-b",
          expectedOwnershipRevision: before.ownershipRevision,
          idempotencyKey: "owner-cross-company",
        },
      ),
    ).rejects.toMatchObject({ httpStatus: 403 });
    const after = await admin.opportunity.findUniqueOrThrow({
      where: { id: "u043-opportunity-a-1" },
    });
    expect(after.ownershipRevision).toBe(before.ownershipRevision);
  });

  it("converts once without force and replays the exact U021 receipt", async () => {
    const opportunity = await admin.opportunity.findUniqueOrThrow({
      where: { id: "u043-opportunity-conversion" },
    });
    const command = {
      opportunityId: opportunity.id,
      expectedUpdatedAt: opportunity.updatedAt.toISOString(),
      idempotencyKey: "opportunity-conversion-1",
    };
    const first = await engagementService.convertOpportunityToProject(
      SALES,
      command,
    );
    const replay = await engagementService.convertOpportunityToProject(
      SALES,
      command,
    );

    expect(first.created).toBe(true);
    expect(replay.engagement.id).toBe(first.engagement.id);
    await expect(
      admin.engagement.count({
        where: { opportunityId: opportunity.id },
      }),
    ).resolves.toBe(1);
  });
});
