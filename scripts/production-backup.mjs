#!/usr/bin/env node
/**
 * production-backup.mjs — take a verified logical backup of the production
 * database on a schedule, and prune old ones.
 *
 * The recovery drill proves the machinery works, but that proof is worthless for
 * data nobody dumped. Until this existed the only backup was one somebody took by
 * hand, and today's mail sat unbacked-up for roughly seventeen hours; the watchdog
 * would eventually have complained about staleness with nothing to fix it.
 *
 * A dump is only counted as taken once `pg_restore --list` can read it back, so a
 * truncated or half-written file fails the job instead of sitting in the directory
 * looking like protection.
 *
 * Usage:
 *   node scripts/production-backup.mjs
 *   node scripts/production-backup.mjs --keep-days 14 --keep-min 5
 *   node scripts/production-backup.mjs --dry-run
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? "sangfor-production";
const PG_CONTAINER = `${PROJECT}-postgres-1`;
const DB_USER = "sangfor";
const DB_NAME = process.env.POSTGRES_DB ?? "sangfor_os";

export const DEFAULT_KEEP_DAYS = 14;
/** Never prune below this many, however old they are — an empty backup directory
 *  is worse than a stale one. */
export const DEFAULT_KEEP_MIN = 5;
/** A dump this small cannot be this database; treat it as a failed write. */
export const MIN_PLAUSIBLE_BYTES = 512 * 1024;

export function backupDir() {
  return process.env.BACKUP_DIR
    ?? join(process.env.HOME ?? "", "Library/Application Support/SangforOS/production-backups");
}

// ---------------------------------------------------------------------------
// Retention — pure, so the rule is testable without touching a disk.
// ---------------------------------------------------------------------------

/**
 * Picks which backups to delete: older than the window, but never so many that
 * fewer than `keepMin` remain.
 * @param {Array<{name: string, mtimeMs: number}>} backups
 */
export function selectForPruning(backups, { now, keepDays = DEFAULT_KEEP_DAYS, keepMin = DEFAULT_KEEP_MIN } = {}) {
  const newestFirst = [...backups].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const cutoff = now - keepDays * 24 * 60 * 60 * 1000;
  return newestFirst
    .slice(keepMin)
    .filter((backup) => backup.mtimeMs < cutoff)
    .map((backup) => backup.name);
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function docker(args, options = {}) {
  return execFileSync("docker", args, { timeout: 600_000, ...options });
}

function listBackups(dir) {
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith(".dump"))
      .map((name) => ({ name, mtimeMs: statSync(join(dir, name)).mtimeMs }));
  } catch {
    return [];
  }
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name, fallback) => {
    const index = args.indexOf(`--${name}`);
    return index === -1 ? fallback : Number.parseInt(args[index + 1], 10);
  };
  const dryRun = args.includes("--dry-run");
  const dir = backupDir();
  mkdirSync(dir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d+Z$/, "Z");
  const name = `scheduled-${stamp}.dump`;
  const path = join(dir, name);

  if (dryRun) {
    process.stdout.write(`would write ${path}\n`);
    const prune = selectForPruning(listBackups(dir), {
      now: Date.now(),
      keepDays: flag("keep-days", DEFAULT_KEEP_DAYS),
      keepMin: flag("keep-min", DEFAULT_KEEP_MIN),
    });
    process.stdout.write(`would prune ${prune.length}: ${prune.join(", ") || "none"}\n`);
    return 0;
  }

  // Write through a partial name so a crash cannot leave a short file that later
  // looks like a usable backup.
  const partial = `${path}.partial`;
  try {
    const dump = docker([
      "exec", PG_CONTAINER,
      "pg_dump", "-U", DB_USER, "-d", DB_NAME, "-Fc", "--no-owner", "--no-privileges",
    ], { maxBuffer: 2 * 1024 * 1024 * 1024 });
    writeFileSync(partial, dump, { mode: 0o600 });
  } catch (error) {
    process.stderr.write(`backup: pg_dump failed: ${error instanceof Error ? error.message : error}\n`);
    return 70;
  }

  const bytes = statSync(partial).size;
  if (bytes < MIN_PLAUSIBLE_BYTES) {
    unlinkSync(partial);
    process.stderr.write(`backup: dump was only ${bytes} bytes; refusing to keep it\n`);
    return 71;
  }

  // Read it back before calling it a backup. pg_restore cannot read a dump from
  // stdin, so verify the file inside the container rather than piping it.
  try {
    docker(["cp", partial, `${PG_CONTAINER}:/tmp/verify.dump`]);
    const listing = docker(["exec", PG_CONTAINER, "pg_restore", "--list", "/tmp/verify.dump"], { encoding: "utf8" });
    const tableData = (listing.match(/TABLE DATA/gu) ?? []).length;
    if (tableData < 1) throw new Error("no TABLE DATA entries in dump");
    process.stdout.write(`verified ${tableData} table-data entries\n`);
  } catch (error) {
    unlinkSync(partial);
    process.stderr.write(`backup: verification failed: ${error instanceof Error ? error.message : error}\n`);
    return 72;
  } finally {
    try { docker(["exec", PG_CONTAINER, "rm", "-f", "/tmp/verify.dump"]); } catch { /* best effort */ }
  }

  execFileSync("mv", [partial, path]);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  writeFileSync(`${path}.sha256`, `${digest}  ${name}\n`, { mode: 0o600 });
  process.stdout.write(`wrote ${name} (${bytes} bytes, sha256 ${digest.slice(0, 16)}…)\n`);

  const prune = selectForPruning(listBackups(dir), {
    now: Date.now(),
    keepDays: flag("keep-days", DEFAULT_KEEP_DAYS),
    keepMin: flag("keep-min", DEFAULT_KEEP_MIN),
  });
  for (const stale of prune) {
    unlinkSync(join(dir, stale));
    try { unlinkSync(join(dir, `${stale}.sha256`)); } catch { /* checksum may predate this script */ }
  }
  if (prune.length > 0) process.stdout.write(`pruned ${prune.length} older than the window\n`);
  return 0;
}

if (process.argv[1]?.endsWith("production-backup.mjs")) {
  process.exit(main());
}
