import { existsSync } from "node:fs";
import { isAbsolute } from "node:path";

export const EXIT = Object.freeze({
  SUCCESS: 0,
  CONFIG: 64,
  BACKUP: 65,
  RESTORE: 66,
  VALIDATION: 67,
  CLEANUP: 68,
});

export const STAGE_FOR_EXIT = Object.freeze({
  64: "config",
  65: "backup",
  66: "restore",
  67: "validation",
  68: "cleanup",
});

export const FAILURE_SCENARIOS = Object.freeze([
  "corrupt-dump",
  "target-restore-failure",
  "content-hash-mismatch",
  "sequence-mismatch",
  "validation-timeout",
]);

export class ContractError extends Error {
  constructor(message) {
    super(message);
    this.exitCode = EXIT.CONFIG;
    this.stage = "config";
  }
}

const KNOWN_FLAGS = new Set([
  "--fixture",
  "--image-digest",
  "--run-id",
  "--evidence-dir",
  "--failure-scenario",
]);

/**
 * Parses the exact restore-drill.mjs CLI contract: positive set
 * `--fixture --image-digest <d> --run-id <id> --evidence-dir <abs>` plus an
 * optional trailing test-only `--failure-scenario <enum>` pair. Rejects
 * unknown/duplicate flags, positional args, and a relative or pre-existing
 * evidence directory before any Docker resource is created.
 * @param {string[]} argv
 */
export function parseRestoreDrillArgs(argv) {
  if (!Array.isArray(argv)) throw new ContractError("argv must be an array");
  // `pnpm restore:drill -- --fixture ...` forwards that pnpm-level `--`
  // separator itself as argv[0] (confirmed empirically against the pinned
  // pnpm version); it is not a caller-supplied flag, so a single leading
  // "--" is dropped before parsing. A second "--" is still rejected below.
  const rest = argv[0] === "--" ? argv.slice(1) : argv;
  const seen = new Set();
  const out = { fixture: false, imageDigest: undefined, runId: undefined, evidenceDir: undefined, failureScenario: undefined };
  let index = 0;
  while (index < rest.length) {
    const token = rest[index];
    if (typeof token !== "string" || !KNOWN_FLAGS.has(token)) {
      throw new ContractError(`unknown or positional argument: ${token}`);
    }
    if (seen.has(token)) throw new ContractError(`duplicate flag: ${token}`);
    seen.add(token);
    if (token === "--fixture") {
      out.fixture = true;
      index += 1;
      continue;
    }
    const value = rest[index + 1];
    if (typeof value !== "string" || value.length === 0 || KNOWN_FLAGS.has(value)) {
      throw new ContractError(`missing value for ${token}`);
    }
    if (token === "--image-digest") out.imageDigest = value;
    else if (token === "--run-id") out.runId = value;
    else if (token === "--evidence-dir") out.evidenceDir = value;
    else if (token === "--failure-scenario") out.failureScenario = value;
    index += 2;
  }
  if (!out.fixture) throw new ContractError("--fixture flag required");
  if (!out.imageDigest || !/^sha256:[0-9a-f]{64}$/.test(out.imageDigest)) {
    throw new ContractError("--image-digest must be sha256:<64hex>");
  }
  if (!out.runId) throw new ContractError("--run-id required");
  if (!out.evidenceDir) throw new ContractError("--evidence-dir required");
  if (!isAbsolute(out.evidenceDir)) throw new ContractError("--evidence-dir must be absolute");
  if (existsSync(out.evidenceDir)) throw new ContractError("--evidence-dir must be a fresh directory");
  if (out.failureScenario !== undefined && !FAILURE_SCENARIOS.includes(out.failureScenario)) {
    throw new ContractError(`unknown --failure-scenario: ${out.failureScenario}`);
  }
  return out;
}

export function fail(exitCode, stage, message) {
  const error = new Error(message);
  error.exitCode = exitCode;
  error.stage = stage;
  return error;
}
