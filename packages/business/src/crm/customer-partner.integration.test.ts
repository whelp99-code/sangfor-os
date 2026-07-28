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
  ".omo/evidence/sangfor-system-refactor-2026-07-15/U043/attempt-1/customer-scratch",
);
const VERSION = new Date("2026-07-24T00:00:00.000Z");

const SALES: AuthContext = {
  userId: "u043-customer-user-a",
  sessionId: "u043-customer-session-a",
  tenantId: "u043-customer-tenant-a",
  companyId: "u043-customer-company-a",
  projectId: "u043-customer-project-a",
  businessRole: "sales_manager",
  permissions: ["customer.read", "customer.write", "opportunity.read", "opportunity.write"],
  product: "portal",
};

let admin: PrismaClient;
let releaseLifecycle: (() => void) | null = null;
let lifecycle: Promise<unknown> | null = null;
let customerService: typeof import("./customer-partner");
let previousDatabaseUrl: string | undefined;

async function seedScope(
  suffix: "a" | "b",
  role: "sales_manager" | "account_manager" = "sales_manager",
) {
  const tenantId = `u043-customer-tenant-${suffix}`;
  const companyId = `u043-customer-company-${suffix}`;
  const projectId = `u043-customer-project-${suffix}`;
  const userId = `u043-customer-user-${suffix}`;
  await admin.tenant.create({
    data: {
      id: tenantId,
      slug: tenantId,
      name: `Customer Tenant ${suffix}`,
      status: "active",
    },
  });
  await admin.company.create({
    data: {
      id: companyId,
      tenantId,
      slug: companyId,
      name: `Customer Company ${suffix}`,
    },
  });
  await admin.project.create({
    data: {
      id: projectId,
      companyId,
      slug: projectId,
      name: `Customer Project ${suffix}`,
    },
  });
  await admin.user.create({
    data: {
      id: userId,
      email: `${userId}@example.test`,
      name: `Customer User ${suffix}`,
      status: "active",
    },
  });
  await admin.userCompanyRole.create({
    data: {
      id: `u043-customer-assignment-${suffix}`,
      userId,
      companyId,
      role,
      status: "active",
      validFrom: new Date("2026-07-23T00:00:00.000Z"),
    },
  });
  await admin.projectMember.create({
    data: {
      id: `u043-customer-member-${suffix}`,
      projectId,
      userId,
      role: "member",
      status: "active",
      validFrom: new Date("2026-07-23T00:00:00.000Z"),
    },
  });
}

describe.skipIf(!integration)("U043 canonical customer integration", () => {
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
        runId: `u043-customer-${Date.now().toString(36)}`,
        ownerUnit: "U043",
        purpose: "crm-customer-integration",
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
      "u043-customer-cursor-secret-32-bytes-minimum";
    admin = new PrismaClient({
      datasources: { db: { url: scratch.migrationDatabaseUrl } },
    });
    await applyU043RlsGrants(admin);
    await seedScope("a");
    await seedScope("b");

    await admin.customer.createMany({
      data: [
        {
          id: "u043-customer-a-1",
          projectId: SALES.projectId,
          name: "Scoped Customer 1",
          domain: "one.example.test",
          updatedAt: VERSION,
        },
        {
          id: "u043-customer-a-2",
          projectId: SALES.projectId,
          name: "Scoped Customer 2",
          domain: "two.example.test",
          updatedAt: VERSION,
        },
        {
          id: "u043-customer-a-3",
          projectId: SALES.projectId,
          name: "Scoped Customer 3",
          domain: "three.example.test",
          updatedAt: VERSION,
        },
        {
          id: "u043-customer-b-sentinel",
          projectId: "u043-customer-project-b",
          name: "Foreign Customer Sentinel",
          domain: "foreign.example.test",
          updatedAt: VERSION,
        },
      ],
    });
    await admin.customerAsset.create({
      data: {
        id: "u043-customer-asset-a",
        customerId: "u043-customer-a-1",
        assetType: "appliance",
        name: "Scoped Asset",
      },
    });
    await admin.renewalOpportunity.create({
      data: {
        id: "u043-customer-renewal-a",
        customerId: "u043-customer-a-1",
        renewalType: "license",
      },
    });
    await admin.supportCase.create({
      data: {
        id: "u043-customer-support-a",
        customerId: "u043-customer-a-1",
        subject: "Scoped Support",
      },
    });

    vi.resetModules();
    customerService = await import("./customer-partner");
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

  it("keeps complete list/detail reads inside the authenticated project", async () => {
    const first = await customerService.listCustomers(SALES, { first: 2 });
    expect(first.items.map((customer) => customer.id)).toEqual([
      "u043-customer-a-3",
      "u043-customer-a-2",
    ]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await customerService.listCustomers(SALES, {
      first: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items.map((customer) => customer.id)).toEqual([
      "u043-customer-a-1",
    ]);
    expect(
      [...first.items, ...second.items].some(
        (customer) => customer.id === "u043-customer-b-sentinel",
      ),
    ).toBe(false);

    const detail = await customerService.getCustomerDetail(
      SALES,
      "u043-customer-a-1",
    );
    expect(detail?.customerAssets.map((asset) => asset.id)).toEqual([
      "u043-customer-asset-a",
    ]);
    expect(
      detail?.renewalOpportunities.map((renewal) => renewal.id),
    ).toEqual(["u043-customer-renewal-a"]);
    expect(detail?.supportCases.map((supportCase) => supportCase.id)).toEqual([
      "u043-customer-support-a",
    ]);
    await expect(
      customerService.getCustomerDetail(SALES, "u043-customer-b-sentinel"),
    ).resolves.toBeNull();
  });

  it("replays exact create and rejects a changed idempotency reuse", async () => {
    const command = {
      name: "Idempotent Customer",
      domain: "idempotent.example.test",
      idempotencyKey: "customer-create-replay",
    };
    const first = await customerService.createCustomer(SALES, command);
    const replay = await customerService.createCustomer(SALES, command);
    expect(replay.id).toBe(first.id);
    await expect(
      customerService.createCustomer(SALES, {
        ...command,
        name: "Changed Customer",
      }),
    ).rejects.toMatchObject({ httpStatus: 409 });
    await expect(
      admin.customer.count({
        where: {
          projectId: SALES.projectId,
          domain: "idempotent.example.test",
        },
      }),
    ).resolves.toBe(1);
  });

  it("allows one CAS update winner and leaves one audit-backed state", async () => {
    const row = await admin.customer.create({
      data: {
        id: "u043-customer-cas",
        projectId: SALES.projectId,
        name: "CAS Customer",
      },
    });
    const results = await Promise.allSettled([
      customerService.updateCustomer(SALES, row.id, {
        expectedUpdatedAt: row.updatedAt.toISOString(),
        changes: { notes: "winner-a" },
        idempotencyKey: "customer-cas-a",
      }),
      customerService.updateCustomer(SALES, row.id, {
        expectedUpdatedAt: row.updatedAt.toISOString(),
        changes: { notes: "winner-b" },
        idempotencyKey: "customer-cas-b",
      }),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    await expect(
      admin.auditLog.count({
        where: {
          projectId: SALES.projectId,
          eventType: "customer.updated",
          resourceId: row.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it("rolls back Customer and audit receipt when the U021 append fails", async () => {
    await admin.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION u043_fail_customer_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.idempotency_key = 'customer.create:customer-forced-audit-failure' THEN
          RAISE EXCEPTION 'u043_forced_audit_failure';
        END IF;
        RETURN NEW;
      END;
      $$
    `);
    await admin.$executeRawUnsafe(`
      CREATE TRIGGER u043_fail_customer_audit_trg
      BEFORE INSERT ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION u043_fail_customer_audit();
    `);

    await expect(
      customerService.createCustomer(SALES, {
        name: "Rollback Customer",
        domain: "rollback.example.test",
        idempotencyKey: "customer-forced-audit-failure",
      }),
    ).rejects.toThrow();
    await expect(
      admin.customer.count({
        where: {
          projectId: SALES.projectId,
          domain: "rollback.example.test",
        },
      }),
    ).resolves.toBe(0);
  });
});
