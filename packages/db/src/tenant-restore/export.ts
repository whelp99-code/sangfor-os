import type { PrismaClient } from "@prisma/client";
import { tableHash } from "./hash";
import { createManifest, type RestoreManifest, type TableManifestEntry } from "./manifest";

export type ExportOptions = {
  runId: string;
  tenantId: string;
  companyId: string;
  projectId: string;
  imageDigest: string;
  tables: { table: string; scopeClass: string; scopeColumn: string }[];
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
    const result = await admin.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM "${t.table}" WHERE "${t.scopeColumn}" = $1 ORDER BY id`,
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

  const schemaResult = await admin.$queryRawUnsafe<{ schema_hash: string }[]>(
    `SELECT encode(digest(string_agg(table_name, ',' ORDER BY table_name), 'sha256'), 'hex') as schema_hash FROM information_schema.tables WHERE table_schema = 'public'`,
  );

  const manifest = createManifest({
    runId: opts.runId,
    sourceTenantId: opts.tenantId,
    sourceCompanyId: opts.companyId,
    sourceProjectId: opts.projectId,
    schemaHash: schemaResult[0]?.schema_hash ?? "unknown",
    tableInventory: inventory,
    globalReferences: [],
    imageDigest: opts.imageDigest,
  });

  return { manifest, rows };
}
