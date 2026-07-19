#!/usr/bin/env node
/**
 * U009 — single outer runner for the T-OPS final-candidate S9a contract
 * (dispatch implementation-contract points 11-17).
 *
 * This process owns exactly three things: preflight identity/safety checks,
 * spawning the tracked `restore:drill` CLI exactly once as a child, and
 * atomically publishing the deterministic `s9a/receipt.json` + sidecar. It
 * never touches Docker directly — all container lifecycle stays inside the
 * restore:drill child, which reuses the U007 pair helper.
 */
import { spawn } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadAndMatchImageLock, DEFAULT_LOCK } from "./lib/isolated-postgres.mjs";
import { loadAndValidateResourceLease } from "./lib/resource-lease.mjs";
import { validateAgainstSchemaFile, sha256Hex, canonicalJsonBytes } from "./lib/restore-drill/receipt.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..");
const RAW_SCHEMA_PATH = join(REPO_ROOT, "scripts/restore-drill-receipt.schema.json");
const S9A_SCHEMA_PATH = join(REPO_ROOT, "scripts/s9a-contract-receipt.schema.json");

const SANITIZED_ENV_KEYS = [
  "PATH", "HOME", "LANG", "LC_ALL", "TERM", "NVM_DIR", "NO_COLOR",
  "TMPDIR", "XDG_CACHE_HOME", "COREPACK_HOME", "PNPM_HOME", "SHELL",
];

// Named categories from dispatch point 11: alias/DATABASE_URL/image
// override/tag override/restore-input-path/DOCKER_HOST/DOCKER_CONTEXT. No
// caller-supplied surface for any of these exists in the positive contract,
// so their presence is itself proof of an override attempt.
export const FORBIDDEN_ENV_KEYS = Object.freeze([
  "ALIAS_S9A_RECEIPT_FILE",
  "DATABASE_URL",
  "IMAGE_DIGEST",
  "IMAGE_TAG",
  "RESTORE_INPUT_PATH",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
]);

const SIGNAL_NUMBER = { SIGINT: 2, SIGTERM: 15 };

export class S9aContractError extends Error {
  constructor(exitCode, stage, message) {
    super(message);
    this.exitCode = exitCode;
    this.stage = stage;
  }
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function sanitizedChildEnv(env) {
  const out = {};
  for (const key of SANITIZED_ENV_KEYS) {
    if (typeof env[key] === "string") out[key] = env[key];
  }
  return out;
}

/** CLI contract: zero arguments only (dispatch point 11). */
export function parseCliArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) {
    throw new S9aContractError(64, "config", "run-s9a-contract.mjs accepts zero CLI arguments");
  }
}

/** Reject every named caller-override surface before any resource is touched. */
export function rejectForbiddenEnv(env) {
  for (const key of FORBIDDEN_ENV_KEYS) {
    if (Object.hasOwn(env, key) && env[key] !== undefined) {
      throw new S9aContractError(64, "config", `forbidden env var must not be set: ${key}`);
    }
  }
}

/** Required env exact set: TASK_RUN_ID, TASK_OWNER_UNIT=U071, RESOURCE_LEASE_FILE, absolute ALIAS_EVIDENCE_DIR, lowercase 40-hex FINAL_CANDIDATE_SHA. */
export function readRequiredEnv(env) {
  const taskRunId = env.TASK_RUN_ID;
  if (typeof taskRunId !== "string" || taskRunId.length === 0) {
    throw new S9aContractError(64, "config", "TASK_RUN_ID is required");
  }
  if (env.TASK_OWNER_UNIT !== "U071") {
    throw new S9aContractError(64, "config", 'TASK_OWNER_UNIT must be exactly "U071"');
  }
  const resourceLeaseFile = env.RESOURCE_LEASE_FILE;
  if (typeof resourceLeaseFile !== "string" || !isAbsolute(resourceLeaseFile)) {
    throw new S9aContractError(64, "config", "RESOURCE_LEASE_FILE must be an absolute path");
  }
  const aliasEvidenceDirRaw = env.ALIAS_EVIDENCE_DIR;
  if (typeof aliasEvidenceDirRaw !== "string" || !isAbsolute(aliasEvidenceDirRaw)) {
    throw new S9aContractError(64, "config", "ALIAS_EVIDENCE_DIR must be an absolute path");
  }
  const finalCandidateSha = env.FINAL_CANDIDATE_SHA;
  if (typeof finalCandidateSha !== "string" || !/^[0-9a-f]{40}$/.test(finalCandidateSha)) {
    throw new S9aContractError(64, "config", "FINAL_CANDIDATE_SHA must be lowercase 40-hex");
  }
  return {
    taskRunId,
    taskOwnerUnit: env.TASK_OWNER_UNIT,
    resourceLeaseFile,
    aliasEvidenceDir: resolve(aliasEvidenceDirRaw),
    finalCandidateSha,
  };
}

/** Reads the repo-root digest lock directly and validates it via the canonical U007 schema. */
export function loadDigestLock(lockPath = DEFAULT_LOCK) {
  let bytes;
  try {
    bytes = readFileSync(lockPath);
  } catch (error) {
    throw new S9aContractError(64, "config", `postgres16 digest lock unreadable: ${error.message}`);
  }
  const lockFileSha256 = sha256Hex(bytes);
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new S9aContractError(64, "config", "postgres16 digest lock is not valid JSON");
  }
  try {
    // Re-validates repository/sourceTag/major=16/digest-format/resolvedImage
    // via the U007 canonical schema; the lock is its own imageDigest source
    // of truth, so this call is a self-consistency + schema proof, not a
    // caller-override comparison (callers cannot supply an image digest).
    loadAndMatchImageLock({ imageDigest: parsed.manifestListDigest, lockPath });
  } catch (error) {
    throw new S9aContractError(64, "config", `postgres16 digest lock schema invalid: ${error.message}`);
  }
  return { lockFileSha256, imageDigest: parsed.manifestListDigest };
}

export function buildGitHeadArgv(repoRoot) {
  return ["bash", join(repoRoot, "scripts/run-workspace-runtime.sh"), "root", "--", "git", "rev-parse", "HEAD"];
}

export function buildChildArgv({ repoRoot, imageDigest, runId, rawEvidenceDir }) {
  return [
    "bash", join(repoRoot, "scripts/run-workspace-runtime.sh"), "root", "--",
    "corepack", "pnpm", "restore:drill", "--",
    "--fixture", "--image-digest", imageDigest, "--run-id", runId, "--evidence-dir", rawEvidenceDir,
  ];
}

function realRunCapture(argv, env) {
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

function realSpawnChild(argv, env) {
  const [cmd, ...args] = argv;
  const child = spawn(cmd, args, { shell: false, env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = new Promise((resolvePromise) => {
    child.on("close", (code, signal) => resolvePromise({ code, signal, stdout, stderr }));
  });
  return { child, done };
}

/** Runs `bash run-workspace-runtime.sh root -- git rev-parse HEAD` once and returns the trimmed SHA. */
export async function checkGitHead({ repoRoot, env, runCapture = realRunCapture }) {
  const argv = buildGitHeadArgv(repoRoot);
  let result;
  try {
    result = await runCapture(argv, sanitizedChildEnv(env));
  } catch (error) {
    throw new S9aContractError(64, "config", `git rev-parse HEAD spawn failed: ${error.message}`);
  }
  if (result.code !== 0) {
    throw new S9aContractError(64, "config", `git rev-parse HEAD failed: ${result.stderr || result.stdout}`);
  }
  const sha = result.stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new S9aContractError(64, "config", `git rev-parse HEAD returned unexpected output: ${result.stdout}`);
  }
  return sha;
}

export function computeFinalPaths(aliasEvidenceDir) {
  const dir = resolve(aliasEvidenceDir, "s9a");
  return { dir, receiptFile: join(dir, "receipt.json"), sidecarFile: join(dir, "receipt.sha256") };
}

/** No reuse/overwrite: the s9a dir and both final files must be absent before any resource. */
export function assertFinalPathsAbsent(paths) {
  for (const candidate of [paths.dir, paths.receiptFile, paths.sidecarFile]) {
    if (pathExists(candidate)) {
      throw new S9aContractError(64, "config", `refusing to reuse or overwrite existing s9a evidence: ${candidate}`);
    }
  }
}

/** Validates raw/receipt.json against the tracked schema plus the cross-checks point 15 requires. */
export function validateRawReceipt({ rawReceiptPath, expected }) {
  let bytes;
  try {
    bytes = readFileSync(rawReceiptPath);
  } catch {
    throw new S9aContractError(67, "validation", `raw receipt missing or unreadable: ${rawReceiptPath}`);
  }
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new S9aContractError(67, "validation", "raw receipt is not valid JSON");
  }
  try {
    validateAgainstSchemaFile(RAW_SCHEMA_PATH, value);
  } catch (error) {
    throw new S9aContractError(67, "validation", `raw receipt failed schema validation: ${error.message}`);
  }
  if (value.unit !== "U009") {
    throw new S9aContractError(67, "validation", "raw receipt unit mismatch");
  }
  if (value.runId !== expected.runId) {
    throw new S9aContractError(67, "validation", "raw receipt runId does not match the launched run");
  }
  if (value.imageDigest !== expected.imageDigest) {
    throw new S9aContractError(67, "validation", "raw receipt imageDigest does not match the locked digest");
  }
  if (value.result !== "PASS" || value.exitCode !== 0) {
    throw new S9aContractError(67, "validation", "raw receipt is not an authoritative PASS");
  }
  if (value.sourceSentinelMatch !== true || value.targetSentinelMatch !== true) {
    throw new S9aContractError(67, "validation", "raw receipt sentinel match is not true for both sides");
  }
  for (const [key, status] of Object.entries(value.checks ?? {})) {
    if (status !== "PASS") {
      throw new S9aContractError(67, "validation", `raw receipt check "${key}" is not PASS (got ${status})`);
    }
  }
  const cleanup = value.cleanup ?? {};
  const counts = [
    cleanup.source?.containers, cleanup.source?.networks, cleanup.source?.volumes,
    cleanup.target?.containers, cleanup.target?.networks, cleanup.target?.volumes,
  ];
  if (counts.some((count) => count !== 0)) {
    throw new S9aContractError(68, "cleanup", "raw receipt cleanup counts are not all zero");
  }
  return { bytes, sha256: sha256Hex(bytes), value };
}

function buildFinalReceipt({ config, lock, childArgv, raw, now }) {
  return {
    schemaVersion: 1,
    unit: "U009",
    alias: "T-OPS",
    runId: config.taskRunId,
    finalCandidateSha: config.finalCandidateSha,
    lockFileSha256: lock.lockFileSha256,
    imageDigest: lock.imageDigest,
    postgresMajor: 16,
    restoreDrill: {
      argv: childArgv,
      exitCode: 0,
      rawReceiptRelativePath: "raw/receipt.json",
      rawReceiptSha256: raw.sha256,
      checks: raw.value.checks,
    },
    cleanup: {
      source: { containers: 0, networks: 0, volumes: 0 },
      target: { containers: 0, networks: 0, volumes: 0 },
    },
    result: "PASS",
    createdAt: now.toISOString(),
  };
}

function cleanupStaging(staging) {
  if (!staging) return true;
  try {
    rmSync(staging, { recursive: true, force: true });
    return !pathExists(staging);
  } catch {
    return false;
  }
}

function publishStaging({ staging, finalPaths, finalReceipt }) {
  const receiptBytes = canonicalJsonBytes(finalReceipt);
  writeFileSync(join(staging, "receipt.json"), receiptBytes, { flag: "wx" });
  writeFileSync(join(staging, "receipt.sha256"), `${sha256Hex(receiptBytes)}\n`, { flag: "wx" });
  if (pathExists(finalPaths.dir)) {
    throw new S9aContractError(64, "config", `s9a evidence appeared during publish: ${finalPaths.dir}`);
  }
  renameSync(staging, finalPaths.dir);
}

/**
 * Orchestrates the full contract: preflight -> spawn restore:drill exactly
 * once -> re-check HEAD -> validate raw receipt -> atomic publish.
 * `deps` is the fake-spawn injection point for run-s9a-contract.test.mjs.
 */
export async function runS9aContract({ argv, env, now = () => new Date(), deps = {} }) {
  const repoRoot = deps.repoRoot ?? REPO_ROOT;
  const runCapture = deps.runCapture ?? realRunCapture;
  const spawnChild = deps.spawnChild ?? realSpawnChild;
  const lockPath = deps.lockPath ?? DEFAULT_LOCK;

  let staging;
  let signalReceived = null;
  let childRef = null;
  // Node invokes a `process.on(signalName, fn)` listener with zero
  // arguments on real signal delivery (the signal name is NOT passed as an
  // argument), so each signal needs its own closure-bound handler rather
  // than a single handler that reads an argument.
  const handleSignal = (signal) => {
    signalReceived = signal;
    if (childRef) childRef.kill(signal);
  };
  const onSigint = () => handleSignal("SIGINT");
  const onSigterm = () => handleSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    // --- Preflight: exit 64 before any resource is created. ---
    parseCliArgs(argv);
    rejectForbiddenEnv(env);
    const config = readRequiredEnv(env);
    loadAndValidateResourceLease(config.resourceLeaseFile, {
      expectedOwnerUnit: config.taskOwnerUnit,
      expectedRunId: config.taskRunId,
    });
    const lock = loadDigestLock(lockPath);
    const preHead = await checkGitHead({ repoRoot, env, runCapture });
    if (preHead !== config.finalCandidateSha) {
      throw new S9aContractError(64, "config", "git HEAD does not match FINAL_CANDIDATE_SHA before restore");
    }
    if (!existsSync(config.aliasEvidenceDir)) {
      throw new S9aContractError(64, "config", `ALIAS_EVIDENCE_DIR does not exist: ${config.aliasEvidenceDir}`);
    }
    const finalPaths = computeFinalPaths(config.aliasEvidenceDir);
    assertFinalPathsAbsent(finalPaths);

    try {
      staging = mktempStaging(config.aliasEvidenceDir);
    } catch (error) {
      throw new S9aContractError(64, "config", `unable to create fresh staging directory: ${error.message}`);
    }

    const rawEvidenceDir = join(staging, "raw");
    const childArgv = buildChildArgv({ repoRoot, imageDigest: lock.imageDigest, runId: config.taskRunId, rawEvidenceDir });
    const childEnv = sanitizedChildEnv(env);

    const { child, done } = spawnChild(childArgv, childEnv);
    childRef = child;
    if (signalReceived) childRef.kill(signalReceived);
    const result = await done;

    if (signalReceived) {
      cleanupStaging(staging);
      return { exitCode: 128 + (SIGNAL_NUMBER[signalReceived] ?? 15) };
    }
    if (result.signal) {
      cleanupStaging(staging);
      return { exitCode: 128 + (SIGNAL_NUMBER[result.signal] ?? 15) };
    }
    if (result.code !== 0) {
      cleanupStaging(staging);
      return { exitCode: result.code };
    }

    const postHead = await checkGitHead({ repoRoot, env, runCapture });
    if (postHead !== config.finalCandidateSha) {
      cleanupStaging(staging);
      return { exitCode: 64 };
    }

    const raw = validateRawReceipt({
      rawReceiptPath: join(rawEvidenceDir, "receipt.json"),
      expected: { runId: config.taskRunId, imageDigest: lock.imageDigest },
    });

    const finalReceipt = buildFinalReceipt({ config, lock, childArgv, raw, now: now() });
    validateAgainstSchemaFile(S9A_SCHEMA_PATH, finalReceipt);
    publishStaging({ staging, finalPaths, finalReceipt });
    return { exitCode: 0, receiptPath: finalPaths.receiptFile, receipt: finalReceipt };
  } catch (error) {
    const cleanupOk = cleanupStaging(staging);
    if (signalReceived) {
      return { exitCode: 128 + (SIGNAL_NUMBER[signalReceived] ?? 15) };
    }
    const primaryExitCode = typeof error.exitCode === "number" ? error.exitCode : 65;
    if (!cleanupOk) {
      return { exitCode: 68, primaryFailureCode: primaryExitCode, error };
    }
    return { exitCode: primaryExitCode, error };
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

function mktempStaging(aliasEvidenceDir) {
  return mkdtempSync(join(aliasEvidenceDir, ".s9a-staging-"));
}

async function main() {
  const result = await runS9aContract({ argv: process.argv.slice(2), env: process.env });
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
  }
  process.exitCode = result.exitCode;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = 65;
  });
}
