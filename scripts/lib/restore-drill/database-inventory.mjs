import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sidecarPathFor(filePath) {
  return filePath.replace(/\.[^./]+$/, ".sha256");
}

function parseConnection(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    user: decodeURIComponent(url.username),
    database: decodeURIComponent(url.pathname.slice(1)),
  };
}

async function queryJson(side, sql) {
  const { user, database } = parseConnection(side.databaseUrl);
  const wrapped = `SELECT coalesce(json_agg(x), '[]'::json) FROM (${sql}) x;`;
  const result = await side.exec([
    "psql", "-h", "127.0.0.1", "-U", user, "-d", database, "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", wrapped,
  ]);
  if (result.code !== 0) {
    const error = new Error(`database-inventory: query failed: ${result.stderr || result.stdout}`);
    error.exitCode = 67;
    error.stage = "validation";
    throw error;
  }
  return JSON.parse(result.stdout.trim() || "[]");
}

const SCHEMA_SQL = `
  SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position
`;

const TABLE_LIST_SQL = `
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name
`;

const SEQUENCE_SQL = `
  SELECT sequencename, last_value
  FROM pg_sequences
  WHERE schemaname = 'public'
  ORDER BY sequencename
`;

const CONSTRAINT_SQL = `
  SELECT conname, contype, conrelid::regclass::text AS table_name,
    CASE WHEN contype = 'c' THEN 'CHECK_VALIDATED=' || convalidated::text ELSE pg_get_constraintdef(oid) END AS definition
  FROM pg_constraint
  WHERE connamespace = 'public'::regnamespace
  ORDER BY conname
`;

export async function fetchSchemaRows(side) {
  return queryJson(side, SCHEMA_SQL);
}

function tableContentHashSql(tableNames) {
  const parts = tableNames.map((name) => {
    const identifier = name.replace(/"/g, "");
    return `SELECT '${identifier.replace(/'/g, "''")}' AS table_name,
      (SELECT count(*) FROM "${identifier}") AS row_count,
      (SELECT md5(coalesce(string_agg(md5(t::text), '' ORDER BY t::text), '')) FROM "${identifier}" t) AS content_hash`;
  });
  return parts.join("\n  UNION ALL\n  ");
}

/** Full (never sampled) per-table row count + canonical content hash for every base table. */
export async function fetchTableRows(side) {
  const tables = (await queryJson(side, TABLE_LIST_SQL)).map((row) => row.table_name);
  if (tables.length === 0) {
    const error = new Error("database-inventory: no base tables found in public schema");
    error.exitCode = 67;
    error.stage = "validation";
    throw error;
  }
  const unionSql = tableContentHashSql(tables);
  return queryJson(side, `${unionSql}\n  ORDER BY table_name`);
}

export async function fetchSequenceRows(side) {
  return queryJson(side, SEQUENCE_SQL);
}

export async function fetchConstraintRows(side) {
  return queryJson(side, CONSTRAINT_SQL);
}

function canonical(rows) {
  return JSON.stringify(rows);
}

/**
 * Writes one comparison artifact (source rows, target rows, match) as the
 * exact tracked raw evidence pair `<fileName>` / sidecar. `injectMismatch`
 * is the test-only content-hash-mismatch / sequence-mismatch failure-scenario
 * hook — it flips the recorded match flag without touching either database.
 */
export function writeComparisonArtifact(evidenceDir, fileName, sourceRows, targetRows, { injectMismatch = false } = {}) {
  const match = injectMismatch ? false : canonical(sourceRows) === canonical(targetRows);
  const filePath = join(evidenceDir, fileName);
  const bytes = Buffer.from(`${JSON.stringify({ source: sourceRows, target: targetRows, match }, null, 2)}\n`, "utf8");
  writeFileSync(filePath, bytes);
  const sha256 = sha256Hex(bytes);
  writeFileSync(sidecarPathFor(filePath), `${sha256}\n`);
  return { match, sha256 };
}

function sanitizedEnv(extra) {
  const allowed = ["PATH", "HOME", "LANG", "LC_ALL", "TERM", "NVM_DIR", "NO_COLOR", "TMPDIR", "XDG_CACHE_HOME", "COREPACK_HOME", "PNPM_HOME", "SHELL"];
  const env = {};
  for (const key of allowed) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return { ...env, ...extra };
}

function spawnCapture(argv, env) {
  return new Promise((resolvePromise, reject) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, { shell: false, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Re-runs the exact formal `db:migrate:deploy` argv against the restored
 * target and confirms it is a no-op: the migration history table travels
 * with the dump/restore, so a second deploy must apply zero migrations.
 */
export async function checkMigrationIdempotency(repoRoot, migrationDatabaseUrl) {
  const argv = ["bash", join(repoRoot, "scripts/run-workspace-runtime.sh"), "root", "--", "corepack", "pnpm", "db:migrate:deploy"];
  const result = await spawnCapture(argv, sanitizedEnv({ DATABASE_URL: migrationDatabaseUrl }));
  const applied = /applying migration/i.test(result.stdout);
  return { pass: result.code === 0 && !applied, exitCode: result.code, applied };
}

export function writeValidationReport(evidenceDir, report) {
  writeFileSync(join(evidenceDir, "validation.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
