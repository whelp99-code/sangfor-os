import { createHash } from "node:crypto";
import { z } from "zod";
import type { AuthContext } from "@sangfor/auth";
import { canonicalizeRfc8785, withRlsTransaction, Prisma } from "@sangfor/db";
import { appendAuditEvent } from "../governance/audit-db";
import { type AuditChainScope } from "../governance/audit-chain";

export class CatalogServiceError extends Error {
  constructor(
    public code: string,
    public httpStatus: number,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "CatalogServiceError";
  }
}

type ScopedTransaction = Prisma.TransactionClient;

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const boundedText = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine((val) => !CONTROL_CHARACTERS.test(val), {
    message: "control_characters_not_allowed",
  });

const nullableText = (max: number) =>
  z.preprocess(
    (val) => (val === "" ? null : val),
    z.string().trim().max(max).nullable().optional(),
  );

const idempotencyKeySchema = boundedText(1, 128);
const expectedUpdatedAtSchema = z.string().datetime({ offset: true });

export const catalogSkuImportSchema = z.object({
  skuCode: boundedText(1, 100),
  name: boundedText(1, 200),
  unitPrice: z.number().finite().nonnegative().nullable().optional(),
  unitCost: z.number().finite().nonnegative().nullable().optional(),
  licenseMetric: nullableText(100),
  licenseMetricKey: nullableText(100),
  currency: z.string().trim().length(3).transform((s) => s.toUpperCase()).nullable().optional(),
  termMonths: z.number().int().nonnegative().nullable().optional(),
  deploymentType: nullableText(100),
  supportLevel: nullableText(100),
}).strict();

export const catalogEditionImportSchema = z.object({
  editionKey: boundedText(1, 100),
  name: boundedText(1, 200),
  version: boundedText(1, 50),
  skus: z.array(catalogSkuImportSchema).default([]),
}).strict();

export const catalogMetricImportSchema = z.object({
  key: boundedText(1, 100),
  name: boundedText(1, 200),
  unit: boundedText(1, 50),
  description: nullableText(1000),
}).strict();

export const catalogPayloadImportSchema = z.object({
  familyKey: boundedText(1, 100),
  vendorKey: boundedText(1, 100),
  vendor: boundedText(1, 200),
  name: boundedText(1, 200),
  description: nullableText(2000),
  category: nullableText(100),
  editions: z.array(catalogEditionImportSchema).default([]),
  metrics: z.array(catalogMetricImportSchema).default([]),
}).strict();

export const catalogImportCommandSchema = z.object({
  payload: catalogPayloadImportSchema,
  dryRun: z.boolean().default(false),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export type CatalogImportCommandInput = z.input<typeof catalogImportCommandSchema>;

export const createProductFamilySchema = z.object({
  familyKey: boundedText(1, 100).optional(),
  vendorKey: boundedText(1, 100).optional(),
  vendor: boundedText(1, 200),
  name: boundedText(1, 200),
  description: nullableText(2000),
  category: nullableText(100),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export type CreateProductFamilyCommandInput = z.input<typeof createProductFamilySchema>;

export const updateProductFamilySchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  changes: z.object({
    name: boundedText(1, 100).optional(),
    description: nullableText(2000),
    category: nullableText(100),
    vendor: boundedText(1, 200).optional(),
  }).refine((data) => Object.keys(data).length > 0, {
    message: "changes_required",
  }),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export type UpdateProductFamilyCommandInput = z.input<typeof updateProductFamilySchema>;

export const archiveProductFamilySchema = z.object({
  expectedUpdatedAt: expectedUpdatedAtSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export type ArchiveProductFamilyCommandInput = z.input<typeof archiveProductFamilySchema>;

export const catalogListQuerySchema = z.object({
  first: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
  search: z.string().optional(),
  vendor: z.string().optional(),
  category: z.string().optional(),
  status: z.string().optional(),
}).strict();

export type CatalogListQueryInput = z.input<typeof catalogListQuerySchema>;

function assertCapability(ctx: AuthContext, required: "catalog.read" | "catalog.write") {
  const perms = (ctx.permissions as string[]) ?? [];
  if (!perms.includes(required) && !perms.includes("catalog.write")) {
    throw new CatalogServiceError("FORBIDDEN", 403, `missing_permission_${required}`);
  }
}

function hasCostReadPermission(ctx: AuthContext): boolean {
  const perms = (ctx.permissions as string[]) ?? [];
  return perms.includes("catalog.cost.read") || perms.includes("catalog.write");
}

function companyAuditScope(ctx: AuthContext): AuditChainScope {
  return {
    level: "COMPANY",
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    projectId: null,
  };
}

function inputHash(contract: string, ctx: AuthContext, payload: unknown): string {
  const canonical = canonicalizeRfc8785({
    contract,
    tenantId: ctx.tenantId,
    companyId: ctx.companyId,
    payload,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

async function checkReplay<T>(
  tx: ScopedTransaction,
  scope: AuditChainScope,
  key: string,
  contract: string,
  hash: string,
): Promise<T | null> {
  const existing = await tx.auditLog.findFirst({
    where: {
      tenantId: scope.tenantId,
      companyId: scope.companyId,
      idempotencyKey: key,
    },
    select: { details: true },
  });
  if (!existing) return null;

  const details = existing.details as { contract?: string; inputHash?: string; result?: unknown } | null;
  if (details?.contract !== contract || details?.inputHash !== hash || !details.result) {
    throw new CatalogServiceError("CONFLICT", 409, "idempotency_key_reused_with_different_payload");
  }
  return details.result as T;
}

export async function listCatalogProducts(ctx: AuthContext, rawQuery: CatalogListQueryInput = {}) {
  assertCapability(ctx, "catalog.read");
  const query = catalogListQuerySchema.parse(rawQuery);
  const canReadCost = hasCostReadPermission(ctx);

  return withRlsTransaction(ctx, async (tx) => {
    const families = await tx.productFamily.findMany({
      where: {
        companyId: ctx.companyId,
        ...(query.status ? { status: query.status } : { archivedAt: null }),
        ...(query.vendor ? { vendor: { contains: query.vendor, mode: "insensitive" } } : {}),
        ...(query.category ? { category: { equals: query.category, mode: "insensitive" } } : {}),
        ...(query.search ? {
          OR: [
            { name: { contains: query.search, mode: "insensitive" } },
            { vendor: { contains: query.search, mode: "insensitive" } },
            { familyKey: { contains: query.search, mode: "insensitive" } },
          ],
        } : {}),
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: query.first + 1,
      include: {
        editions: {
          where: { archivedAt: null },
          include: {
            skus: {
              where: { archivedAt: null },
            },
          },
        },
        licenseMetrics: true,
      },
    });

    const hasMore = families.length > query.first;
    const items = families.slice(0, query.first).map((fam) => ({
      ...fam,
      editions: fam.editions.map((ed) => ({
        ...ed,
        skus: ed.skus.map((sku) => ({
          ...sku,
          unitCost: canReadCost ? (sku.unitCost ? Number(sku.unitCost) : null) : null,
          unitPrice: sku.unitPrice ? Number(sku.unitPrice) : null,
        })),
      })),
    }));

    return {
      items,
      nextCursor: hasMore && items.length > 0 ? items.at(-1)?.id : null,
    };
  });
}

async function getCatalogProductDetailInTx(tx: ScopedTransaction, ctx: AuthContext, id: string) {
  const canReadCost = hasCostReadPermission(ctx);
  const family = await tx.productFamily.findFirst({
    where: {
      id,
      companyId: ctx.companyId,
    },
    include: {
      editions: {
        include: {
          skus: {
            include: {
              canonicalLicenseMetric: true,
            },
          },
        },
      },
      licenseMetrics: true,
    },
  });

  if (!family) return null;

  return {
    ...family,
    editions: family.editions.map((ed) => ({
      ...ed,
      skus: ed.skus.map((sku) => ({
        ...sku,
        unitCost: canReadCost ? (sku.unitCost ? Number(sku.unitCost) : null) : null,
        unitPrice: sku.unitPrice ? Number(sku.unitPrice) : null,
      })),
    })),
  };
}

export async function getCatalogProductDetail(ctx: AuthContext, id: string) {
  assertCapability(ctx, "catalog.read");
  return withRlsTransaction(ctx, (tx) => getCatalogProductDetailInTx(tx, ctx, id));
}

export async function createProductFamily(ctx: AuthContext, rawCommand: CreateProductFamilyCommandInput) {
  assertCapability(ctx, "catalog.write");
  const command = createProductFamilySchema.parse(rawCommand);
  const contract = "sangfor.catalog.family.create/v1";
  const hash = inputHash(contract, ctx, command);
  const auditKey = `catalog.family.create:${command.idempotencyKey}`;
  const scope = companyAuditScope(ctx);

  return withRlsTransaction(ctx, async (tx) => {
    const replayResult = await checkReplay<typeof family>(tx, scope, auditKey, contract, hash);
    if (replayResult) return replayResult;

    const family = await tx.productFamily.create({
      data: {
        companyId: ctx.companyId,
        familyKey: command.familyKey ?? null,
        vendorKey: command.vendorKey ?? null,
        vendor: command.vendor,
        name: command.name,
        description: command.description ?? null,
        category: command.category ?? null,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    await appendAuditEvent(tx, {
      scope,
      eventType: "catalog.family.created",
      actorId: ctx.userId,
      resourceType: "product_family",
      resourceId: family.id,
      idempotencyKey: auditKey,
      details: JSON.parse(JSON.stringify({ contract, inputHash: hash, result: family })),
    });

    return family;
  });
}

export async function updateProductFamily(ctx: AuthContext, id: string, rawCommand: UpdateProductFamilyCommandInput) {
  assertCapability(ctx, "catalog.write");
  const command = updateProductFamilySchema.parse(rawCommand);
  const contract = "sangfor.catalog.family.update/v1";
  const hash = inputHash(contract, ctx, { id, ...command });
  const auditKey = `catalog.family.update:${command.idempotencyKey}`;
  const scope = companyAuditScope(ctx);

  return withRlsTransaction(ctx, async (tx) => {
    const replayResult = await checkReplay<typeof updated>(tx, scope, auditKey, contract, hash);
    if (replayResult) return replayResult;

    const existing = await tx.productFamily.findFirst({
      where: { id, companyId: ctx.companyId },
    });

    if (!existing) {
      throw new CatalogServiceError("NOT_FOUND", 404, "product_family_not_found");
    }

    if (existing.updatedAt && existing.updatedAt.toISOString() !== command.expectedUpdatedAt) {
      throw new CatalogServiceError("CONFLICT", 409, "stale_update_conflict");
    }

    const updated = await tx.productFamily.update({
      where: { id },
      data: {
        ...command.changes,
        updatedAt: new Date(),
      },
    });

    await appendAuditEvent(tx, {
      scope,
      eventType: "catalog.family.updated",
      actorId: ctx.userId,
      resourceType: "product_family",
      resourceId: updated.id,
      idempotencyKey: auditKey,
      details: JSON.parse(JSON.stringify({ contract, inputHash: hash, result: updated })),
    });

    return updated;
  });
}

export async function archiveProductFamily(ctx: AuthContext, id: string, rawCommand: ArchiveProductFamilyCommandInput) {
  assertCapability(ctx, "catalog.write");
  const command = archiveProductFamilySchema.parse(rawCommand);
  const contract = "sangfor.catalog.family.archive/v1";
  const hash = inputHash(contract, ctx, { id, ...command });
  const auditKey = `catalog.family.archive:${command.idempotencyKey}`;
  const scope = companyAuditScope(ctx);

  return withRlsTransaction(ctx, async (tx) => {
    const replayResult = await checkReplay<typeof archived>(tx, scope, auditKey, contract, hash);
    if (replayResult) return replayResult;

    const existing = await tx.productFamily.findFirst({
      where: { id, companyId: ctx.companyId },
    });

    if (!existing) {
      throw new CatalogServiceError("NOT_FOUND", 404, "product_family_not_found");
    }

    if (existing.updatedAt && existing.updatedAt.toISOString() !== command.expectedUpdatedAt) {
      throw new CatalogServiceError("CONFLICT", 409, "stale_archive_conflict");
    }

    const now = new Date();
    const archived = await tx.productFamily.update({
      where: { id },
      data: {
        status: "archived",
        archivedAt: now,
        updatedAt: now,
      },
    });

    await appendAuditEvent(tx, {
      scope,
      eventType: "catalog.family.archived",
      actorId: ctx.userId,
      resourceType: "product_family",
      resourceId: archived.id,
      idempotencyKey: auditKey,
      details: JSON.parse(JSON.stringify({ contract, inputHash: hash, result: archived })),
    });

    return archived;
  });
}

export async function unarchiveProductFamily(ctx: AuthContext, id: string, rawCommand: ArchiveProductFamilyCommandInput) {
  assertCapability(ctx, "catalog.write");
  const command = archiveProductFamilySchema.parse(rawCommand);
  const contract = "sangfor.catalog.family.unarchive/v1";
  const hash = inputHash(contract, ctx, { id, ...command });
  const auditKey = `catalog.family.unarchive:${command.idempotencyKey}`;
  const scope = companyAuditScope(ctx);

  return withRlsTransaction(ctx, async (tx) => {
    const replayResult = await checkReplay<typeof unarchived>(tx, scope, auditKey, contract, hash);
    if (replayResult) return replayResult;

    const existing = await tx.productFamily.findFirst({
      where: { id, companyId: ctx.companyId },
    });

    if (!existing) {
      throw new CatalogServiceError("NOT_FOUND", 404, "product_family_not_found");
    }

    if (existing.updatedAt && existing.updatedAt.toISOString() !== command.expectedUpdatedAt) {
      throw new CatalogServiceError("CONFLICT", 409, "stale_unarchive_conflict");
    }

    const now = new Date();
    const unarchived = await tx.productFamily.update({
      where: { id },
      data: {
        status: "active",
        archivedAt: null,
        updatedAt: now,
      },
    });

    await appendAuditEvent(tx, {
      scope,
      eventType: "catalog.family.unarchived",
      actorId: ctx.userId,
      resourceType: "product_family",
      resourceId: unarchived.id,
      idempotencyKey: auditKey,
      details: JSON.parse(JSON.stringify({ contract, inputHash: hash, result: unarchived })),
    });

    return unarchived;
  });
}

export type CatalogImportResult = {
  family?: any;
  created: boolean;
  dryRun: boolean;
  summary?: {
    familyKey: string;
    vendor: string;
    name: string;
    editionsCount: number;
    skusCount: number;
    metricsCount: number;
  };
};

export async function importCatalogPayload(ctx: AuthContext, rawCommand: CatalogImportCommandInput): Promise<CatalogImportResult> {
  assertCapability(ctx, "catalog.write");
  const command = catalogImportCommandSchema.parse(rawCommand);
  const contract = "sangfor.catalog.import/v1";
  const hash = inputHash(contract, ctx, command.payload);
  const auditKey = `catalog.import:${command.idempotencyKey}`;
  const scope = companyAuditScope(ctx);

  return withRlsTransaction(ctx, async (tx) => {
    const replayResult = await checkReplay<CatalogImportResult>(
      tx,
      scope,
      auditKey,
      contract,
      hash,
    );
    if (replayResult) return { ...replayResult, created: false };

    const { payload, dryRun } = command;

    if (dryRun) {
      const result: CatalogImportResult = {
        created: true,
        dryRun: true,
        summary: {
          familyKey: payload.familyKey,
          vendor: payload.vendor,
          name: payload.name,
          editionsCount: payload.editions.length,
          skusCount: payload.editions.reduce((acc, ed) => acc + ed.skus.length, 0),
          metricsCount: payload.metrics.length,
        },
      };
      return result;
    }

    const now = new Date();

    // 1. Upsert / Create ProductFamily for company
    let family = await tx.productFamily.findFirst({
      where: { companyId: ctx.companyId, familyKey: payload.familyKey },
    });

    if (family) {
      family = await tx.productFamily.update({
        where: { id: family.id },
        data: {
          vendorKey: payload.vendorKey,
          vendor: payload.vendor,
          name: payload.name,
          description: payload.description ?? null,
          category: payload.category ?? null,
          status: "active",
          archivedAt: null,
          updatedAt: now,
        },
      });
    } else {
      family = await tx.productFamily.create({
        data: {
          companyId: ctx.companyId,
          familyKey: payload.familyKey,
          vendorKey: payload.vendorKey,
          vendor: payload.vendor,
          name: payload.name,
          description: payload.description ?? null,
          category: payload.category ?? null,
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    // 2. Metrics
    const metricMap = new Map<string, string>(); // metricKey -> metricId
    for (const m of payload.metrics) {
      let metric = await tx.licenseMetric.findUnique({ where: { key: m.key } });
      if (metric) {
        if (metric.productFamilyId !== family.id) {
          throw new CatalogServiceError("CONFLICT", 409, `metric_${m.key}_bound_to_other_family`);
        }
        metric = await tx.licenseMetric.update({
          where: { id: metric.id },
          data: {
            name: m.name,
            unit: m.unit,
            description: m.description ?? null,
            updatedAt: now,
          },
        });
      } else {
        metric = await tx.licenseMetric.create({
          data: {
            productFamilyId: family.id,
            key: m.key,
            name: m.name,
            unit: m.unit,
            description: m.description ?? null,
            status: "active",
            createdAt: now,
            updatedAt: now,
          },
        });
      }
      metricMap.set(m.key, metric.id);
    }

    // 3. Editions & SKUs
    for (const ed of payload.editions) {
      let edition = await tx.productEdition.findFirst({
        where: { familyId: family.id, editionKey: ed.editionKey },
      });

      if (edition) {
        edition = await tx.productEdition.update({
          where: { id: edition.id },
          data: {
            name: ed.name,
            version: ed.version,
            status: "active",
            archivedAt: null,
            updatedAt: now,
          },
        });
      } else {
        edition = await tx.productEdition.create({
          data: {
            familyId: family.id,
            editionKey: ed.editionKey,
            name: ed.name,
            version: ed.version,
            status: "active",
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      for (const s of ed.skus) {
        const metricId = s.licenseMetricKey ? metricMap.get(s.licenseMetricKey) ?? null : null;
        let sku = await tx.productSku.findUnique({ where: { skuCode: s.skuCode } });

        if (sku) {
          await tx.productSku.update({
            where: { id: sku.id },
            data: {
              editionId: edition.id,
              licenseMetricId: metricId,
              name: s.name,
              unitPrice: s.unitPrice != null ? new Prisma.Decimal(s.unitPrice) : null,
              unitCost: s.unitCost != null ? new Prisma.Decimal(s.unitCost) : null,
              licenseMetric: s.licenseMetric ?? null,
              currency: s.currency ?? null,
              termMonths: s.termMonths ?? null,
              deploymentType: s.deploymentType ?? null,
              supportLevel: s.supportLevel ?? null,
              status: "active",
              archivedAt: null,
              updatedAt: now,
            },
          });
        } else {
          await tx.productSku.create({
            data: {
              editionId: edition.id,
              licenseMetricId: metricId,
              skuCode: s.skuCode,
              name: s.name,
              unitPrice: s.unitPrice != null ? new Prisma.Decimal(s.unitPrice) : null,
              unitCost: s.unitCost != null ? new Prisma.Decimal(s.unitCost) : null,
              licenseMetric: s.licenseMetric ?? null,
              currency: s.currency ?? null,
              termMonths: s.termMonths ?? null,
              deploymentType: s.deploymentType ?? null,
              supportLevel: s.supportLevel ?? null,
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          });
        }
      }
    }

    const fullFamily = await getCatalogProductDetailInTx(tx, ctx, family.id);
    const result: CatalogImportResult = { family: fullFamily, created: true, dryRun: false };

    await appendAuditEvent(tx, {
      scope,
      eventType: "catalog.imported",
      actorId: ctx.userId,
      resourceType: "product_family",
      resourceId: family.id,
      idempotencyKey: auditKey,
      details: JSON.parse(JSON.stringify({ contract, inputHash: hash, result })),
    });

    return result;
  });
}
