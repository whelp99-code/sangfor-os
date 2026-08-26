import { createHash } from "node:crypto";

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalize((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(",")}}`;
  }
  return String(value);
}

function semanticRowHash(row: Record<string, unknown>, excludeKeys: string[] = []): string {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!excludeKeys.includes(k)) filtered[k] = v;
  }
  return sha256Hex(canonicalize(filtered));
}

export function tableHash(rows: Record<string, unknown>[]): string {
  const rowHashes = rows.map((r) => semanticRowHash(r, ["id", "created_at", "updated_at"]));
  return sha256Hex(rowHashes.sort().join(","));
}
