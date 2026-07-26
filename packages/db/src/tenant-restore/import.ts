import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

import { readPublicSchemaHash } from './export';
import { tableHash } from './hash';
import { assertAllowedColumn, quoteAllowedColumn, quoteAllowedTable, restoreTableSpec } from './identifiers';
import { validateManifest, type RestoreManifest } from './manifest';

export type ImportOptions = {
  targetTenantId: string;
  targetCompanyId: string;
  targetProjectId: string;
  idempotencyKey: string;
};

export type ImportResult = {
  imported: boolean;
  idempotent: boolean;
  remapMap: Record<string, string>;
  tableCounts: Record<string, number>;
  semanticHashes: Record<string, string>;
};

function deterministicId(idempotencyKey: string, sourceId: string): string {
  return `restore_${createHash('sha256').update(`${idempotencyKey}\0${sourceId}`).digest('hex').slice(0, 24)}`;
}

function validateRows(manifest: RestoreManifest, rows: Record<string, Record<string, unknown>[]>): void {
  const manifestTables = new Set(manifest.tableInventory.map((entry) => entry.table));
  for (const table of Object.keys(rows)) {
    if (!manifestTables.has(table)) throw new Error(`Rows contain a table absent from manifest: ${table}`);
    restoreTableSpec(table);
  }

  for (const entry of manifest.tableInventory) {
    restoreTableSpec(entry.table);
    const tableRows = rows[entry.table];
    if (!tableRows) throw new Error(`Rows are missing manifest table: ${entry.table}`);
    for (const row of tableRows) {
      for (const column of Object.keys(row)) assertAllowedColumn(entry.table, column);
      if (typeof row.id !== 'string' || row.id.length === 0) throw new Error(`Restore row lacks a string id: ${entry.table}`);
    }
    if (tableRows.length !== entry.rowCount) throw new Error(`Restore row count mismatch: ${entry.table}`);
    if (tableHash(tableRows) !== entry.tableHash) throw new Error(`Restore table hash mismatch: ${entry.table}`);
  }

  const companies = rows.companies ?? [];
  const projects = rows.projects ?? [];
  const customers = rows.customers ?? [];
  const activities = rows.customer_activity_logs ?? [];
  if (companies.some((row) => row.tenant_id !== manifest.sourceTenantId)) throw new Error('Cross-scope company row rejected');
  if (companies.length !== 1 || companies[0].id !== manifest.sourceCompanyId) throw new Error('Source company root mismatch');
  if (projects.some((row) => row.company_id !== manifest.sourceCompanyId)) throw new Error('Cross-scope project row rejected');
  if (projects.length !== 1 || projects[0].id !== manifest.sourceProjectId) throw new Error('Source project root mismatch');
  if (customers.some((row) => row.project_id !== manifest.sourceProjectId)) throw new Error('Cross-scope customer row rejected');
  const customerIds = new Set(customers.map((row) => row.id));
  if (activities.some((row) => !customerIds.has(row.customer_id))) throw new Error('Cross-scope CHILD_VIA_FK row rejected');
}

async function readRowsByIds(
  admin: PrismaClient,
  table: string,
  ids: string[],
): Promise<Record<string, unknown>[]> {
  if (ids.length === 0) return [];
  const quotedTable = quoteAllowedTable(table);
  const found: Record<string, unknown>[] = [];
  for (const id of ids) {
    const result = await admin.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM ${quotedTable} WHERE "id" = $1`, id);
    found.push(...result);
  }
  return found;
}

export async function importTenantScope(
  admin: PrismaClient,
  manifest: RestoreManifest,
  rows: Record<string, Record<string, unknown>[]>,
  opts: ImportOptions,
): Promise<ImportResult> {
  const validation = validateManifest(manifest);
  if (!validation.valid) throw new Error(`Invalid manifest: ${validation.errors.join(', ')}`);
  validateRows(manifest, rows);

  const targetSchemaHash = await readPublicSchemaHash(admin);
  if (targetSchemaHash !== manifest.schemaHash) throw new Error('Restore schema hash mismatch');

  const remapMap: Record<string, string> = {
    [manifest.sourceTenantId]: opts.targetTenantId,
    [manifest.sourceCompanyId]: opts.targetCompanyId,
    [manifest.sourceProjectId]: opts.targetProjectId,
  };
  for (const entry of manifest.tableInventory) {
    for (const row of rows[entry.table] ?? []) {
      const sourceId = row.id as string;
      remapMap[sourceId] ??= deterministicId(opts.idempotencyKey, sourceId);
    }
  }

  const remappedRows: Record<string, Record<string, unknown>[]> = {};
  const tableCounts: Record<string, number> = {};
  const semanticHashes: Record<string, string> = {};
  for (const entry of manifest.tableInventory) {
    const mapped = (rows[entry.table] ?? []).map((sourceRow) => {
      const row = { ...sourceRow };
      for (const [column, value] of Object.entries(row)) {
        if (typeof value === 'string' && remapMap[value]) row[column] = remapMap[value];
      }
      if ('created_at' in row) row.created_at = new Date();
      if ('updated_at' in row) row.updated_at = new Date();
      return row;
    });
    remappedRows[entry.table] = mapped;
    tableCounts[entry.table] = mapped.length;
    semanticHashes[entry.table] = tableHash(mapped);
  }

  let existingCount = 0;
  for (const entry of manifest.tableInventory) {
    const expected = remappedRows[entry.table];
    const existing = await readRowsByIds(admin, entry.table, expected.map((row) => row.id as string));
    existingCount += existing.length;
    if (existing.length > 0 && (existing.length !== expected.length || tableHash(existing) !== tableHash(expected))) {
      throw new Error(`Restore idempotency conflict: ${entry.table}`);
    }
  }
  const expectedCount = Object.values(remappedRows).reduce((sum, tableRows) => sum + tableRows.length, 0);
  if (existingCount > 0) {
    if (existingCount !== expectedCount) throw new Error('Restore idempotency conflict: partial prior import');
    return { imported: false, idempotent: true, remapMap, tableCounts, semanticHashes };
  }

  await admin.$transaction(async (tx) => {
    for (const entry of manifest.tableInventory) {
      const quotedTable = quoteAllowedTable(entry.table);
      for (const row of remappedRows[entry.table]) {
        const columns = Object.keys(row);
        const quotedColumns = columns.map((column) => quoteAllowedColumn(entry.table, column));
        const placeholders = columns.map((_, index) => `$${index + 1}`);
        await tx.$executeRawUnsafe(
          `INSERT INTO ${quotedTable} (${quotedColumns.join(', ')}) VALUES (${placeholders.join(', ')})`,
          ...columns.map((column) => row[column]),
        );
      }
    }
  });

  return { imported: true, idempotent: false, remapMap, tableCounts, semanticHashes };
}
