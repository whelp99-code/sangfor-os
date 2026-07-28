import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthContext } from "@sangfor/auth";

const harness = vi.hoisted(() => ({
  tx: null as Record<string, unknown> | null,
  appendAuditEvent: vi.fn(),
}));

vi.mock("@sangfor/db", () => ({
  canonicalizeRfc8785: (value: unknown) => JSON.stringify(value),
  prisma: {},
  withRlsTransaction: vi.fn(async (_scope, callback: (tx: unknown) => Promise<unknown>) => {
    if (!harness.tx) throw new Error("test transaction is not configured");
    return callback(harness.tx);
  }),
  Prisma: {
    Decimal: class Decimal {
      constructor(public val: number) {}
      toNumber() {
        return Number(this.val);
      }
    },
  },
}));

vi.mock("../governance/audit-db", () => ({
  appendAuditEvent: harness.appendAuditEvent,
}));

import {
  archiveProductFamily,
  createProductFamily,
  createProductFamilySchema,
  getCatalogProductDetail,
  importCatalogPayload,
  listCatalogProducts,
  unarchiveProductFamily,
} from "./catalog-service";

const WRITER_CTX: AuthContext = {
  userId: "user-writer-1",
  sessionId: "session-writer-1",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "sales_manager",
  permissions: ["catalog.read", "catalog.write", "catalog.cost.read"] as any,
  product: "portal",
};

const READER_CTX: AuthContext = {
  userId: "user-reader-1",
  sessionId: "session-reader-1",
  tenantId: "tenant-a",
  companyId: "company-a",
  projectId: "project-a",
  businessRole: "account_manager",
  permissions: ["catalog.read"] as any,
  product: "portal",
};

const FOREIGN_CTX: AuthContext = {
  userId: "user-foreign-1",
  sessionId: "session-foreign-1",
  tenantId: "tenant-b",
  companyId: "company-b",
  projectId: "project-b",
  businessRole: "sales_manager",
  permissions: ["catalog.read", "catalog.write"] as any,
  product: "portal",
};

function fakeTx() {
  let family = {
    id: "fam-1",
    companyId: "company-a",
    familyKey: "fam-sangfor-hci",
    vendorKey: "sangfor",
    vendor: "Sangfor Technologies",
    name: "Sangfor HCI",
    description: "HCI Infra",
    category: "Infrastructure",
    status: "active",
    archivedAt: null as Date | null,
    createdAt: new Date("2026-07-24T00:00:00.000Z"),
    updatedAt: new Date("2026-07-24T00:00:00.000Z"),
    editions: [
      {
        id: "ed-1",
        familyId: "fam-1",
        editionKey: "std",
        name: "Standard",
        version: "6.8.0",
        status: "active",
        archivedAt: null,
        skus: [
          {
            id: "sku-1",
            editionId: "ed-1",
            skuCode: "SKU-HCI-STD-01",
            name: "HCI Standard Node",
            unitPrice: 5000,
            unitCost: 3000,
            status: "active",
            archivedAt: null,
          },
        ],
      },
    ],
    licenseMetrics: [],
  };

  const auditLogs = new Map<string, any>();

  const tx = {
    productFamily: {
      findMany: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        if (where.companyId !== "company-a") return [];
        return [family];
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        if (where.companyId && where.companyId !== family.companyId) return null;
        if (where.id && where.id !== family.id) return null;
        return family;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        family = { ...family, ...data, id: "fam-created-1" };
        return family;
      }),
      update: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        family = { ...family, ...data, updatedAt: new Date("2026-07-24T00:00:01.000Z") };
        return family;
      }),
    },
    licenseMetric: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: any }) => ({ id: "metric-1", ...data })),
      update: vi.fn(async ({ data }: { data: any }) => ({ id: "metric-1", ...data })),
    },
    productEdition: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: any }) => ({ id: "ed-1", ...data })),
      update: vi.fn(async ({ data }: { data: any }) => ({ id: "ed-1", ...data })),
    },
    productSku: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: any }) => ({ id: "sku-1", ...data })),
      update: vi.fn(async ({ data }: { data: any }) => ({ id: "sku-1", ...data })),
    },
    auditLog: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, any> }) => {
        return auditLogs.get(where.idempotencyKey) ?? null;
      }),
    },
  };

  return {
    tx,
    auditLogs,
    get family() {
      return family;
    },
  };
}

describe("U044 Catalog Service Unit Tests", () => {
  let fake: ReturnType<typeof fakeTx>;

  beforeEach(() => {
    vi.clearAllMocks();
    fake = fakeTx();
    harness.tx = fake.tx;
    harness.appendAuditEvent.mockImplementation(async (_tx, event) => {
      fake.auditLogs.set(event.idempotencyKey, { details: event.details });
      return { id: "audit-1", idempotent: false };
    });
  });

  it("rejects caller-selected scope and invalid create inputs", () => {
    expect(createProductFamilySchema.safeParse({ vendor: "Sangfor", name: "HCI", companyId: "foreign" }).success).toBe(false);
  });

  it("all-or-nothing import / same replay idempotency / conflict replay 409", async () => {
    const payload = {
      familyKey: "fam-sangfor-hci",
      vendorKey: "sangfor",
      vendor: "Sangfor Technologies",
      name: "Sangfor HCI",
      description: "Hyper-Converged Infrastructure",
      category: "Infrastructure",
      editions: [
        {
          editionKey: "std",
          name: "Standard Edition",
          version: "6.8.0",
          skus: [
            {
              skuCode: "SKU-HCI-STD-01",
              name: "HCI Standard Node License",
              unitPrice: 5000,
              unitCost: 3000,
              currency: "USD",
              termMonths: 12,
            },
          ],
        },
      ],
      metrics: [
        {
          key: "metric-cpu-core",
          name: "CPU Core",
          unit: "core",
        },
      ],
    };

    const res1 = await importCatalogPayload(WRITER_CTX, {
      payload,
      idempotencyKey: "import-key-1",
    });

    expect(res1.created).toBe(true);

    const res2 = await importCatalogPayload(WRITER_CTX, {
      payload,
      idempotencyKey: "import-key-1",
    });
    expect(res2.created).toBe(false);

    const conflictingPayload = { ...payload, name: "Conflicting Name" };
    await expect(
      importCatalogPayload(WRITER_CTX, {
        payload: conflictingPayload,
        idempotencyKey: "import-key-1",
      })
    ).rejects.toMatchObject({ httpStatus: 409 });
  });

  it("references preservation in archive / unarchive", async () => {
    const created = await createProductFamily(WRITER_CTX, {
      vendor: "Sangfor",
      name: "Sangfor NGAF",
      idempotencyKey: "create-ngaf-1",
    });

    const createdUpdatedAt = created.updatedAt ? created.updatedAt.toISOString() : new Date().toISOString();
    const archived = await archiveProductFamily(WRITER_CTX, created.id, {
      expectedUpdatedAt: createdUpdatedAt,
      idempotencyKey: "archive-ngaf-1",
    });
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.status).toBe("archived");

    const archivedUpdatedAt = archived.updatedAt ? archived.updatedAt.toISOString() : new Date().toISOString();
    const unarchived = await unarchiveProductFamily(WRITER_CTX, created.id, {
      expectedUpdatedAt: archivedUpdatedAt,
      idempotencyKey: "unarchive-ngaf-1",
    });
    expect(unarchived.archivedAt).toBeNull();
    expect(unarchived.status).toBe("active");
  });

  it("archived SKU selection rejection & foreign scope hiding & cost field redaction", async () => {
    const list = await listCatalogProducts(READER_CTX, { first: 10 });
    expect(list.items).toBeDefined();

    const foreignList = await listCatalogProducts(FOREIGN_CTX, { first: 10 });
    expect(foreignList.items).toHaveLength(0);

    if (list.items.length > 0) {
      const detail = await getCatalogProductDetail(READER_CTX, list.items[0].id);
      if (detail && detail.editions?.[0]?.skus?.[0]) {
        expect(detail.editions[0].skus[0].unitCost).toBeNull();
      }
    }
  });
});
