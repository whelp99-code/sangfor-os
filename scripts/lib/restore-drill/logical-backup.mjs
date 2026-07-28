import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

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

/**
 * Runs pg_dump -Fc inside the source container via its exec array API and
 * writes the exact raw evidence pair dump.custom / dump.sha256.
 * `injectCorruption` is the test-only corrupt-dump failure-scenario hook: it
 * flips trailing bytes of a real dump so pg_restore fails deterministically.
 * @param {{exec: Function, databaseUrl: string}} source
 */
export async function createLogicalDump(source, evidenceDir, { injectCorruption = false } = {}) {
  const { user, database } = parseConnection(source.databaseUrl);
  const result = await source.exec(
    ["pg_dump", "-h", "127.0.0.1", "-U", user, "-d", database, "-Fc", "--no-owner", "--no-privileges"],
    { binaryOutput: true },
  );
  if (result.code !== 0) {
    const error = new Error(`logical-backup: pg_dump failed: ${result.stderr}`);
    error.exitCode = 65;
    error.stage = "backup";
    throw error;
  }
  let bytes = result.stdoutBuffer;
  if (injectCorruption) {
    bytes = Buffer.from(bytes);
    const tailStart = Math.max(0, bytes.length - 32);
    for (let i = tailStart; i < bytes.length; i += 1) bytes[i] = bytes[i] ^ 0xff;
  }
  const dumpPath = join(evidenceDir, "dump.custom");
  writeFileSync(dumpPath, bytes);
  const sha256 = sha256Hex(bytes);
  writeFileSync(sidecarPathFor(dumpPath), `${sha256}\n`);
  return { dumpPath, bytes, sha256 };
}

/**
 * Restores dump bytes into target via pg_restore streamed over the exec
 * array API's stdin. `injectFailure` is the test-only target-restore-failure
 * hook: it fails before touching the container, exactly like a real refusal.
 * @param {{exec: Function, databaseUrl: string}} target
 */
export async function restoreLogicalDump(target, dumpBytes, { injectFailure = false } = {}) {
  if (injectFailure) {
    const error = new Error("logical-backup: target-restore-failure injected");
    error.exitCode = 66;
    error.stage = "restore";
    throw error;
  }
  const { user, database } = parseConnection(target.databaseUrl);
  const result = await target.exec(
    ["pg_restore", "-h", "127.0.0.1", "-U", user, "-d", database, "--no-owner", "--no-privileges", "--exit-on-error"],
    { input: dumpBytes },
  );
  if (result.code !== 0) {
    const error = new Error(`logical-backup: pg_restore failed: ${result.stderr}`);
    error.exitCode = 66;
    error.stage = "restore";
    throw error;
  }
  return result;
}
