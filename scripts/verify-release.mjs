/**
 * U007 — structured three-workspace release verifier.
 * Internal authoritative invocation (inside detached mirror only):
 *   bash scripts/run-workspace-runtime.sh root -- corepack pnpm verify:release
 * Trailing argv / --scope / step filters → exit 64.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { dirname, join, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateCommandResult } from "./lib/strict-command-result.mjs";
import { scanFalseGreenTests } from "./check-no-false-green-tests.mjs";
import {
  withIsolatedPostgres,
  loadAndMatchImageLock,
  DEFAULT_LOCK,
} from "./lib/isolated-postgres.mjs";
import { makeSanitizedProcessEnv } from "./lib/sanitized-process-env.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const EXPECTED_STEP_IDS = [
  "root-lint",
  "root-typecheck",
  "root-unit",
  "root-integration",
  "root-build",
  "engineer-lint",
  "engineer-typecheck",
  "engineer-unit",
  "engineer-integration",
  "engineer-build",
  "workflow-lint",
  "workflow-typecheck",
  "workflow-unit",
  "workflow-integration",
  "workflow-build",
];

const SCOPE_CWD = {
  root: ".",
  engineer: "services/sangfor-engineer-mcp",
  workflow: "services/sangfor-mcp-workflow",
};

function fail(code, msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

/**
 * Semantic validation beyond JSON schema.
 * @param {object} manifest
 */
export function validateManifestSemantics(manifest) {
  if (manifest.schemaVersion !== 1) {
    throw Object.assign(new Error("schemaVersion must be 1"), { exitCode: 64 });
  }
  if (!Array.isArray(manifest.steps) || manifest.steps.length !== 15) {
    throw Object.assign(new Error("exactly 15 steps"), { exitCode: 64 });
  }
  const ids = manifest.steps.map((s) => s.id);
  if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_STEP_IDS)) {
    throw Object.assign(new Error("step id order mismatch"), { exitCode: 64 });
  }

  const kindsByScope = { root: [], engineer: [], workflow: [] };
  for (const step of manifest.steps) {
    const fields = [
      "id",
      "scope",
      "kind",
      "cwd",
      "env",
      "argv",
      "database",
      "resultPolicy",
    ];
    for (const k of Object.keys(step)) {
      if (!fields.includes(k)) {
        throw Object.assign(new Error(`unknown step field ${k}`), {
          exitCode: 64,
        });
      }
    }
    for (const f of fields) {
      if (!(f in step)) {
        throw Object.assign(new Error(`missing step field ${f}`), {
          exitCode: 64,
        });
      }
    }
    if (!["root", "engineer", "workflow"].includes(step.scope)) {
      throw Object.assign(new Error("bad scope"), { exitCode: 64 });
    }
    if (SCOPE_CWD[step.scope] !== step.cwd) {
      throw Object.assign(new Error(`cwd mismatch for ${step.id}`), {
        exitCode: 64,
      });
    }
    if (isAbsolute(step.cwd)) {
      throw Object.assign(new Error("absolute cwd forbidden"), { exitCode: 64 });
    }
    if (!Array.isArray(step.argv) || step.argv.length === 0) {
      throw Object.assign(new Error("argv empty"), { exitCode: 64 });
    }
    if (step.argv.some((a) => a === "-c" || a === "eval" || a === "--if-present")) {
      throw Object.assign(new Error("forbidden argv token"), { exitCode: 64 });
    }
    const isTest = step.kind === "unit" || step.kind === "integration";
    const expectedPolicy = isTest ? "strict-test" : "command";
    if (step.resultPolicy !== expectedPolicy) {
      throw Object.assign(new Error(`resultPolicy for ${step.id}`), {
        exitCode: 64,
      });
    }
    kindsByScope[step.scope].push(step.kind);

    // env validation
    for (const [k, v] of Object.entries(step.env || {})) {
      if (!v || typeof v !== "object") {
        throw Object.assign(new Error(`env ${k}`), { exitCode: 64 });
      }
      const keys = Object.keys(v);
      if (keys.length !== 1 || !["literal", "from"].includes(keys[0])) {
        throw Object.assign(new Error(`env value shape ${k}`), { exitCode: 64 });
      }
    }

    if (step.database.mode === "none") {
      if (step.env.DATABASE_URL || step.env.TASK_POSTGRES_RECEIPT_FILE) {
        throw Object.assign(new Error(`DB env on none mode ${step.id}`), {
          exitCode: 64,
        });
      }
    } else if (step.database.mode === "scratch-pg16") {
      if (!step.env.CI_INTEGRATION || step.env.CI_INTEGRATION.literal !== "1") {
        throw Object.assign(new Error(`CI_INTEGRATION required ${step.id}`), {
          exitCode: 64,
        });
      }
      if (!Array.isArray(step.database.migrationArgv) || step.database.migrationArgv.length === 0) {
        throw Object.assign(new Error("migrationArgv"), { exitCode: 64 });
      }
    } else {
      throw Object.assign(new Error("bad database.mode"), { exitCode: 64 });
    }
  }

  for (const scope of ["root", "engineer", "workflow"]) {
    const expected = ["lint", "typecheck", "unit", "integration", "build"];
    if (JSON.stringify(kindsByScope[scope]) !== JSON.stringify(expected)) {
      throw Object.assign(new Error(`kind order for ${scope}`), { exitCode: 64 });
    }
  }
}

function spawnArgv(argv, { cwd, env }) {
  return new Promise((resolvePromise, reject) => {
    const [cmd, ...args] = argv;
    const child = spawn(cmd, args, {
      shell: false,
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      resolvePromise({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * @param {{manifestPath: string, schemaPath: string, evidenceDir?: string, root?: string}} opts
 */
export async function runVerifyRelease(opts) {
  const root = opts.root ?? REPO_ROOT;
  const manifestPath = resolve(opts.manifestPath);
  const schemaPath = resolve(opts.schemaPath);

  if (!existsSync(manifestPath) || !existsSync(schemaPath)) {
    fail(64, "manifest/schema missing");
  }

  const manifestSha = sha256File(manifestPath);
  const schemaSha = sha256File(schemaPath);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

  // Basic schema structural checks
  if (schema.additionalProperties !== false) {
    fail(64, "schema must set additionalProperties false");
  }
  if (!schema.required || !schema.required.includes("schemaVersion")) {
    fail(64, "schema required fields");
  }

  validateManifestSemantics(manifest);

  // Preflight false-green scan
  const scan = scanFalseGreenTests(root);
  if (!scan.ok) {
    // For authoritative product release this is intentional RED before steps.
    // verify-release itself fails closed on false-green.
    const report = {
      ok: false,
      reason: "FALSE_GREEN_TEST_SCRIPT",
      findings: scan.findings,
      manifestSha,
      schemaSha,
    };
    if (opts.evidenceDir) {
      mkdirSync(opts.evidenceDir, { recursive: true });
      writeFileSync(
        join(opts.evidenceDir, "release-preflight.json"),
        JSON.stringify(report, null, 2),
      );
    }
    process.stderr.write(
      JSON.stringify({ preflightBlockers: scan.findings }, null, 2) + "\n",
    );
    process.exit(64);
  }

  const lock = loadAndMatchImageLock({
    imageDigest: JSON.parse(readFileSync(DEFAULT_LOCK, "utf8")).manifestListDigest,
    lockPath: DEFAULT_LOCK,
  });

  const wrapper = join(root, "scripts/run-workspace-runtime.sh");
  /** @type {object[]} */
  const stepResults = [];

  for (const step of manifest.steps) {
    const started = Date.now();
    const baseEnv = makeSanitizedProcessEnv({ lane: "generic" });

    const runStep = async (envExtra = {}) => {
      const env = { ...baseEnv, ...envExtra };
      // resolve env from manifest
      for (const [k, spec] of Object.entries(step.env)) {
        if ("literal" in spec) env[k] = spec.literal;
        else if ("from" in spec) {
          const v = envExtra[spec.from] ?? env[spec.from];
          if (!v) {
            throw Object.assign(new Error(`unresolved env ref ${spec.from}`), {
              exitCode: 64,
            });
          }
          env[k] = v;
        }
      }

      const argv = [wrapper, step.scope, "--", ...step.argv];
      const r = await spawnArgv(argv, { cwd: root, env });
      const verdict = evaluateCommandResult({
        exitCode: r.code,
        stdout: r.stdout,
        stderr: r.stderr,
        policy: step.resultPolicy,
        receiptPresent: true,
      });
      return { r, verdict, env };
    };

    if (step.database.mode === "scratch-pg16") {
      const evidenceDir = join(
        opts.evidenceDir ?? join(root, ".tmp-release-pg"),
        step.id,
      );
      await withIsolatedPostgres(
        {
          runId: `verify-${step.id}-${Date.now()}`,
          ownerUnit: "U007",
          purpose: `release-${step.id}`,
          evidenceDir,
          imageDigest: lock.manifestListDigest,
          migrate: false,
        },
        async (ctx) => {
          // run migrations then test
          for (const margv of step.database.migrationArgv) {
            const m = await spawnArgv([wrapper, step.scope, "--", ...margv], {
              cwd: root,
              env: {
                ...baseEnv,
                DATABASE_URL: ctx.databaseUrl,
              },
            });
            if (m.code !== 0) {
              fail(64, `migration failed for ${step.id}: ${m.stderr}`);
            }
          }
          const { r, verdict } = await runStep({
            TASK_OWNED_DATABASE_URL: ctx.databaseUrl,
            TASK_POSTGRES_RECEIPT_FILE: ctx.receiptPath,
            DATABASE_URL: ctx.databaseUrl,
            CI_INTEGRATION: "1",
          });
          stepResults.push({
            id: step.id,
            exitCode: r.code,
            durationMs: Date.now() - started,
            verdict: verdict.verdict,
            reason: verdict.reason,
            counts: verdict.counts,
            outputHash: verdict.outputHash,
          });
          if (verdict.verdict !== "PASS") {
            fail(64, `step ${step.id} ${verdict.reason}`);
          }
        },
      );
    } else {
      const { r, verdict } = await runStep();
      stepResults.push({
        id: step.id,
        exitCode: r.code,
        durationMs: Date.now() - started,
        verdict: verdict.verdict,
        reason: verdict.reason,
        counts: verdict.counts,
        outputHash: verdict.outputHash,
      });
      if (verdict.verdict !== "PASS") {
        fail(64, `step ${step.id} ${verdict.reason}`);
      }
    }
  }

  const receipt = {
    ok: true,
    manifestSha,
    schemaSha,
    steps: stepResults,
  };
  process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}

function main() {
  const argv = process.argv.slice(2);
  // Reject scope/filter/trailing
  if (argv.some((a) => a === "--scope" || a.startsWith("--step") || a === "--only")) {
    fail(64, "scope/step filters forbidden");
  }
  let manifest = join(REPO_ROOT, "scripts/release-gate.manifest.json");
  let schema = join(REPO_ROOT, "scripts/release-gate.manifest.schema.json");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--manifest") {
      manifest = resolve(argv[++i]);
    } else if (argv[i] === "--schema") {
      schema = resolve(argv[++i]);
    } else if (argv[i] === "--evidence-dir") {
      // optional
      i += 1;
    } else {
      fail(64, `unexpected arg ${argv[i]}`);
    }
  }

  runVerifyRelease({
    manifestPath: manifest,
    schemaPath: schema,
    evidenceDir: process.env.ACCEPTANCE_EVIDENCE_DIR,
  }).catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(err?.exitCode ?? 64);
  });
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
