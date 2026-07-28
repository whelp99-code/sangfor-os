import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
export const SEED_PATH = join(REPO_ROOT, "tests/restore-drill/fixtures/deterministic-seed.sql");

export function loadDeterministicSeed() {
  const bytes = readFileSync(SEED_PATH);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { path: SEED_PATH, bytes, sha256, text: bytes.toString("utf8") };
}

function parseConnection(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    user: decodeURIComponent(url.username),
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

/**
 * Applies the exact tracked deterministic-seed.sql bytes to `source` via its
 * exec array API exactly once. No caller-supplied path, no Prisma seed.ts.
 * @param {{exec: Function, databaseUrl: string}} source
 */
export async function applyDeterministicSeed(source) {
  const seed = loadDeterministicSeed();
  const { user, database } = parseConnection(source.databaseUrl);
  const result = await source.exec(
    ["psql", "-h", "127.0.0.1", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"],
    { input: seed.text },
  );
  if (result.code !== 0) {
    const error = new Error(`fixture-seed: apply failed: ${result.stderr || result.stdout}`);
    error.exitCode = 65;
    error.stage = "backup";
    throw error;
  }
  return seed;
}
