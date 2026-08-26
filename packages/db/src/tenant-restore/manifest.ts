import { sha256Hex, canonicalize } from "./hash";

export type RestoreManifest = {
  version: "v1";
  runId: string;
  sourceTenantId: string;
  sourceCompanyId: string;
  sourceProjectId: string;
  schemaHash: string;
  tableInventory: TableManifestEntry[];
  globalReferences: string[];
  exportedAt: string;
  toolVersion: string;
  imageDigest: string;
};

export type TableManifestEntry = {
  table: string;
  scopeClass: string;
  rowCount: number;
  tableHash: string;
  businessKeys: string[];
};

export function createManifest(input: {
  runId: string;
  sourceTenantId: string;
  sourceCompanyId: string;
  sourceProjectId: string;
  schemaHash: string;
  tableInventory: TableManifestEntry[];
  globalReferences: string[];
  imageDigest: string;
}): RestoreManifest {
  return {
    version: "v1",
    runId: input.runId,
    sourceTenantId: input.sourceTenantId,
    sourceCompanyId: input.sourceCompanyId,
    sourceProjectId: input.sourceProjectId,
    schemaHash: input.schemaHash,
    tableInventory: input.tableInventory,
    globalReferences: input.globalReferences,
    exportedAt: new Date().toISOString(),
    toolVersion: "sangfor-tenant-restore/v1",
    imageDigest: input.imageDigest,
  };
}

function manifestHash(manifest: RestoreManifest): string {
  return sha256Hex(canonicalize({
    version: manifest.version,
    sourceTenantId: manifest.sourceTenantId,
    sourceCompanyId: manifest.sourceCompanyId,
    sourceProjectId: manifest.sourceProjectId,
    schemaHash: manifest.schemaHash,
    tableInventory: manifest.tableInventory,
    globalReferences: manifest.globalReferences,
  }));
}

export function validateManifest(manifest: RestoreManifest): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (manifest.version !== "v1") errors.push("unsupported manifest version");
  if (!manifest.sourceTenantId) errors.push("missing sourceTenantId");
  if (!manifest.sourceCompanyId) errors.push("missing sourceCompanyId");
  if (!manifest.sourceProjectId) errors.push("missing sourceProjectId");
  if (!manifest.schemaHash) errors.push("missing schemaHash");
  if (!manifest.tableInventory || manifest.tableInventory.length === 0) errors.push("empty table inventory");
  if (manifest.tableInventory && new Set(manifest.tableInventory.map((entry) => entry.table)).size !== manifest.tableInventory.length) errors.push("duplicate table inventory entry");
  if (!manifest.imageDigest || !manifest.imageDigest.startsWith("sha256:")) errors.push("invalid imageDigest");
  return { valid: errors.length === 0, errors };
}
