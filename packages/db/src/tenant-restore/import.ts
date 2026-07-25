import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { tableHash } from "./hash";
import { validateManifest, type RestoreManifest } from "./manifest";

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

export async function importTenantScope(
  admin: PrismaClient,
  manifest: RestoreManifest,
  rows: Record<string, Record<string, unknown>[]>,
  opts: ImportOptions,
): Promise<ImportResult> {
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new Error(`Invalid manifest: ${validation.errors.join(", ")}`);
  }

  const existing = await admin.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT count(*) as count FROM "_prisma_migrations" WHERE migration_name = $1`,
    `tenant-restore:${opts.idempotencyKey}`,
  );
  if (existing[0] && Number(existing[0].count) > 0) {
    return { imported: false, idempotent: true, remapMap: {}, tableCounts: {}, semanticHashes: {} };
  }

  const remapMap: Record<string, string> = {};
  const tableCounts: Record<string, number> = {};
  const semanticHashes: Record<string, string> = {};

  const scopeRemap: Record<string, string> = {
    [manifest.sourceTenantId]: opts.targetTenantId,
    [manifest.sourceCompanyId]: opts.targetCompanyId,
    [manifest.sourceProjectId]: opts.targetProjectId,
  };

  await admin.$transaction(async (tx) => {
    for (const entry of manifest.tableInventory) {
      const tableRows = rows[entry.table] ?? [];
      if (tableRows.length === 0) {
        tableCounts[entry.table] = 0;
        semanticHashes[entry.table] = tableHash([]);
        continue;
      }

      const remappedRows: Record<string, unknown>[] = [];
      for (const row of tableRows) {
        const remapped = { ...row };
        if (remapped.id && typeof remapped.id === "string") {
          const newId = randomUUID();
          remapMap[remapped.id as string] = newId;
          remapped.id = newId;
        }
        for (const [oldScope, newScope] of Object.entries(scopeRemap)) {
          for (const [k, v] of Object.entries(remapped)) {
            if (v === oldScope) remapped[k] = newScope;
          }
        }
        for (const [k, v] of Object.entries(remapped)) {
          if (typeof v === "string" && remapMap[v]) {
            remapped[k] = remapMap[v];
          }
        }
        remapped.created_at = new Date();
        remapped.updated_at = new Date();
        remappedRows.push(remapped);
      }

      for (const row of remappedRows) {
        const columns = Object.keys(row);
        const placeholders = columns.map((_, i) => `$${i + 1}`);
        await tx.$executeRawUnsafe(
          `INSERT INTO "${entry.table}" (${columns.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders.join(", ")})`,
          ...columns.map((c) => row[c]),
        );
      }

      tableCounts[entry.table] = remappedRows.length;
      semanticHashes[entry.table] = tableHash(remappedRows);
    }

    await tx.$executeRawUnsafe(
      `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, applied_steps_count, finished_at) VALUES ($1, $2, $3, $4, NOW())`,
      randomUUID(),
      createHash("sha256").update(opts.idempotencyKey).digest("hex"),
      `tenant-restore:${opts.idempotencyKey}`,
      1,
    );
  });

  return { imported: true, idempotent: false, remapMap, tableCounts, semanticHashes };
}
