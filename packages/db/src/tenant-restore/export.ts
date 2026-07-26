import type { PrismaClient } from "@prisma/client";
import { tableHash } from "./hash";
import { quoteAllowedColumn, quoteAllowedTable, restoreTableSpec, type RestoreTableSpec } from './identifiers';
import { createManifest, type RestoreManifest, type TableManifestEntry } from "./manifest";

export type ExportOptions = {
  runId: string;
  tenantId: string;
  companyId: string;
  projectId: string;
  imageDigest: string;
  tables: readonly RestoreTableSpec[];
};

export type ExportResult = {
  manifest: RestoreManifest;
  rows: Record<string, Record<string, unknown>[]>;
};

export async function exportTenantScope(
  admin: PrismaClient,
  opts: ExportOptions,
): Promise<ExportResult> {
  const rows: Record<string, Record<string, unknown>[]> = {};
  const inventory: TableManifestEntry[] = [];

  for (const t of opts.tables) {
    const allowlisted = restoreTableSpec(t.table);
    if (t.scopeClass !== allowlisted.scopeClass || t.scopeColumn !== allowlisted.scopeColumn) {
      throw new Error(`Restore table contract mismatch: ${t.table}`);
    }
    const table = quoteAllowedTable(t.table);
    const scopeColumn = quoteAllowedColumn(t.table, t.scopeColumn);
    const result = t.table === 'companies'
      ? await admin.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM ${table} WHERE ${scopeColumn} = $1 AND "id" = $2 ORDER BY "id"`,
          opts.tenantId,
          opts.companyId,
        )
      : t.table === 'projects'
        ? await admin.$queryRawUnsafe<Record<string, unknown>[]>(
            `SELECT * FROM ${table} WHERE ${scopeColumn} = $1 AND "id" = $2 ORDER BY "id"`,
            opts.companyId,
            opts.projectId,
          )
        : t.scopeClass === 'CHILD_VIA_FK'
      ? await admin.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT child.* FROM ${table} AS child WHERE EXISTS (SELECT 1 FROM "customers" AS parent WHERE parent."id" = child.${scopeColumn} AND parent."project_id" = $1) ORDER BY child."id"`,
          opts.projectId,
        )
      : await admin.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT * FROM ${table} WHERE ${scopeColumn} = $1 ORDER BY id`,
          t.scopeColumn === "tenant_id" ? opts.tenantId : t.scopeColumn === "company_id" ? opts.companyId : opts.projectId,
        );
    rows[t.table] = result;
    inventory.push({
      table: t.table,
      scopeClass: t.scopeClass,
      rowCount: result.length,
      tableHash: tableHash(result),
      businessKeys: result.length > 0 ? Object.keys(result[0]).filter((k) => k.endsWith("_key") || k === "slug") : [],
    });
  }

  const schemaHash = await readPublicSchemaHash(admin);

  const manifest = createManifest({
    runId: opts.runId,
    sourceTenantId: opts.tenantId,
    sourceCompanyId: opts.companyId,
    sourceProjectId: opts.projectId,
    schemaHash,
    tableInventory: inventory,
    globalReferences: [],
    imageDigest: opts.imageDigest,
  });

  return { manifest, rows };
}

export async function readPublicSchemaHash(admin: PrismaClient): Promise<string> {
  const result = await admin.$queryRawUnsafe<{ schema_hash: string }[]>(
    `SELECT encode(digest(string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || COALESCE(column_default, ''), ',' ORDER BY table_name, ordinal_position), 'sha256'), 'hex') AS schema_hash FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  return result[0]?.schema_hash ?? 'unknown';
}
