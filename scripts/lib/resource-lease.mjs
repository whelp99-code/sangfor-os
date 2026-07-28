/**
 * U007 — RESOURCE_LEASE_FILE loader and validator.
 */
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync, lstatSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UNIT_RE = /^U0(0[1-9]|[1-6][0-9]|7[0-6])$/;
const RFC3339_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * @param {number} mode
 * @returns {boolean}
 */
function isGroupOrWorldWritable(mode) {
  return (mode & 0o022) !== 0;
}

/**
 * @param {string} absolutePath
 */
function assertNotGroupWorldWritable(absolutePath) {
  const st = lstatSync(absolutePath);
  if (st.isSymbolicLink()) {
    throw fail64(`resource-lease: symlink not allowed: ${absolutePath}`);
  }
  if (isGroupOrWorldWritable(st.mode)) {
    throw fail64(`resource-lease: group/world writable: ${absolutePath}`);
  }
  const parent = dirname(absolutePath);
  const pst = statSync(parent);
  if (isGroupOrWorldWritable(pst.mode)) {
    throw fail64(`resource-lease: parent group/world writable: ${parent}`);
  }
}

function fail64(message) {
  return Object.assign(new Error(message), { exitCode: 64 });
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {string} leaseFileAbsolute
 * @param {{
 *   expectedOwnerUnit: string,
 *   expectedRunId?: string,
 *   expectedWebPort?: number,
 *   expectedApiPort?: number,
 *   now?: Date,
 * }} checks
 */
export function loadAndValidateResourceLease(leaseFileAbsolute, checks) {
  if (!leaseFileAbsolute || typeof leaseFileAbsolute !== "string") {
    throw fail64("resource-lease: missing absolute path");
  }
  if (!leaseFileAbsolute.startsWith("/")) {
    throw fail64("resource-lease: path must be absolute");
  }

  assertNotGroupWorldWritable(leaseFileAbsolute);

  const raw = readFileSync(leaseFileAbsolute, "utf8");
  const sha256 = createHash("sha256").update(raw, "utf8").digest("hex");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw fail64("resource-lease: invalid JSON");
  }
  if (!isRecord(parsed)) throw fail64("resource-lease: not an object");

  const required = [
    "runId",
    "ownerUnit",
    "webPort",
    "apiPort",
    "issuedAt",
    "expiresAt",
  ];
  for (const key of required) {
    if (!(key in parsed)) throw fail64(`resource-lease: missing field ${key}`);
  }
  for (const key of Object.keys(parsed)) {
    if (!required.includes(key)) {
      throw fail64(`resource-lease: unknown field ${key}`);
    }
  }

  const runId = parsed.runId;
  const ownerUnit = parsed.ownerUnit;
  const webPort = parsed.webPort;
  const apiPort = parsed.apiPort;
  const issuedAt = parsed.issuedAt;
  const expiresAt = parsed.expiresAt;

  if (typeof runId !== "string" || runId.length === 0) {
    throw fail64("resource-lease: invalid runId");
  }
  if (typeof ownerUnit !== "string" || !UNIT_RE.test(ownerUnit)) {
    throw fail64("resource-lease: invalid ownerUnit");
  }
  if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
    throw fail64("resource-lease: invalid webPort");
  }
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw fail64("resource-lease: invalid apiPort");
  }
  if (webPort === apiPort) {
    throw fail64("resource-lease: webPort and apiPort must differ");
  }
  // non-loopback ports are still integers; binding validation is elsewhere.
  // Reject common privileged/system ambiguity only for non-numeric handled above.
  if (typeof issuedAt !== "string" || !RFC3339_RE.test(issuedAt)) {
    throw fail64("resource-lease: invalid issuedAt");
  }
  if (typeof expiresAt !== "string" || !RFC3339_RE.test(expiresAt)) {
    throw fail64("resource-lease: invalid expiresAt");
  }

  const now = checks.now ?? new Date();
  const issued = new Date(issuedAt);
  const expires = new Date(expiresAt);
  if (Number.isNaN(issued.getTime()) || Number.isNaN(expires.getTime())) {
    throw fail64("resource-lease: unparseable timestamps");
  }
  if (issued.getTime() > now.getTime() + 1000) {
    throw fail64("resource-lease: issuedAt is in the future");
  }
  if (expires.getTime() <= now.getTime()) {
    throw fail64("resource-lease: lease expired");
  }
  if (expires.getTime() <= issued.getTime()) {
    throw fail64("resource-lease: expiresAt before issuedAt");
  }

  if (checks.expectedOwnerUnit && ownerUnit !== checks.expectedOwnerUnit) {
    throw fail64(
      `resource-lease: ownerUnit mismatch (lease=${ownerUnit}, expected=${checks.expectedOwnerUnit})`,
    );
  }
  if (checks.expectedRunId && runId !== checks.expectedRunId) {
    throw fail64("resource-lease: runId mismatch");
  }
  if (
    checks.expectedWebPort !== undefined &&
    webPort !== checks.expectedWebPort
  ) {
    throw fail64("resource-lease: webPort mismatch with env");
  }
  if (
    checks.expectedApiPort !== undefined &&
    apiPort !== checks.expectedApiPort
  ) {
    throw fail64("resource-lease: apiPort mismatch with env");
  }

  return {
    runId,
    ownerUnit,
    webPort,
    apiPort,
    issuedAt,
    expiresAt,
    sha256,
    redacted: {
      runId,
      ownerUnit,
      webPort,
      apiPort,
      issuedAt,
      expiresAt,
    },
  };
}

/**
 * Validate env PORT/API_PORT against lease and TASK_OWNER_UNIT.
 * @param {NodeJS.ProcessEnv} env
 * @param {string} leaseFileAbsolute
 */
export function validateLeaseAgainstEnv(env, leaseFileAbsolute) {
  const owner = env.TASK_OWNER_UNIT;
  if (!owner) throw fail64("resource-lease: TASK_OWNER_UNIT required");
  const runId = env.TASK_RUN_ID;
  if (!runId) throw fail64("resource-lease: TASK_RUN_ID required");

  const portRaw = env.PORT;
  const apiPortRaw = env.API_PORT;
  if (portRaw === undefined || apiPortRaw === undefined) {
    throw fail64("resource-lease: PORT and API_PORT required");
  }
  const webPort = Number(portRaw);
  const apiPort = Number(apiPortRaw);
  if (!Number.isInteger(webPort) || !Number.isInteger(apiPort)) {
    throw fail64("resource-lease: PORT/API_PORT must be integers");
  }
  if (webPort === apiPort) {
    throw fail64("resource-lease: PORT and API_PORT must differ");
  }

  return loadAndValidateResourceLease(leaseFileAbsolute, {
    expectedOwnerUnit: owner,
    expectedRunId: runId,
    expectedWebPort: webPort,
    expectedApiPort: apiPort,
  });
}

export function schemaPath() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "resource-lease.schema.json");
}
