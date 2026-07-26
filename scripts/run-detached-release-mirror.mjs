/**
 * U007 — outer detached release mirror runner.
 * Modes: u007-release | u030-post-release | u076-final-aliases
 *
 * Pre-U030 successful outer exit is exactly 78 (RED_EXPECTED product)
 * ONLY when runner_contract_status=PASS is derived from real in-mirror checks.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { withDetachedReleaseMirror } from "./lib/detached-release-mirror.mjs";
import { loadAndValidateResourceLease } from "./lib/resource-lease.mjs";
import { scanFalseGreenTests } from "./check-no-false-green-tests.mjs";
import {
  withIsolatedPostgres,
  loadAndMatchImageLock,
  DEFAULT_LOCK,
  LABEL_RUN,
} from "./lib/isolated-postgres.mjs";
import { validateManifestSemantics } from "./verify-release.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MODES = new Set([
  "u007-release",
  "u030-post-release",
  "u076-final-aliases",
]);

const RUNNER_CHECK_KEYS = [
  "manifest15Lanes",
  "strictResultParser",
  "falseGreenFixtures",
  "sanitizedEnv",
  "scratchPostgres",
  "apiProductionStart",
  "playwrightCoreFlow",
  "detachedMirrorCleanup",
];

const INSTALL_SCOPES = ["root", "engineer", "workflow"];

const STRICT_PARSER_TESTS = [
  "scripts/lib/strict-command-result.test.mjs",
];
const FALSE_GREEN_FIXTURE_TESTS = [
  "scripts/check-no-false-green-tests.test.mjs",
];
const OTHER_RUNNER_UNIT_TESTS = [
  "scripts/lib/sanitized-process-env.test.mjs",
  "scripts/lib/resource-lease.test.mjs",
  "scripts/release-state-receipt.test.mjs",
  "scripts/verify-release.test.mjs",
];

function fail(code, msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

function abort(code, message) {
  throw Object.assign(new Error(message), { exitCode: code });
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function spawnCapture(argv, { cwd = REPO_ROOT, env = process.env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolvePromise({ code: code ?? 1, signal, stdout, stderr }));
  });
}

function sha256Text(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function validateScmHandoff(handoffFile, candidateSha) {
  const invalid = (message) => {
    const error = new Error(message);
    error.exitCode = 64;
    throw error;
  };
  const canonicalFile = resolve(handoffFile);
  const metadata = lstatSync(canonicalFile);
  if (metadata.isSymbolicLink() || !metadata.isFile() || realpathSync(canonicalFile) !== canonicalFile) {
    invalid("SCM handoff must be a canonical regular non-symlink file");
  }
  const bytes = readFileSync(canonicalFile);
  const handoff = JSON.parse(bytes.toString("utf8"));
  if (
    JSON.stringify(Object.keys(handoff).sort()) !== JSON.stringify(["candidateSha", "committedBy", "issuedAt", "sourceHead", "sourceStatus"].sort()) ||
    handoff.candidateSha !== candidateSha ||
    handoff.committedBy !== "SCM" ||
    handoff.sourceHead !== candidateSha ||
    handoff.sourceStatus !== "clean" ||
    Number.isNaN(Date.parse(handoff.issuedAt))
  ) {
    invalid("SCM handoff envelope identity or shape mismatch");
  }
  return Object.freeze({ file: canonicalFile, sha256: createHash("sha256").update(bytes).digest("hex") });
}

export function finalAcceptanceInnerArgv(contextFile, contextHash) {
  return [
    "bash",
    "scripts/run-workspace-runtime.sh",
    "root",
    "--",
    "node",
    "scripts/run-final-acceptance.mjs",
    "--mirror-context-file",
    contextFile,
    "--mirror-context-sha256",
    contextHash,
  ];
}

/**
 * Atomic exclusive-create publish of receipt + sidecar.
 */
function publishReceipt(absPath, obj) {
  if (existsSync(absPath)) {
    fail(64, `receipt path must be absent: ${absPath}`);
  }
  const sidecar = absPath.replace(/\.json$/, ".sha256");
  if (existsSync(sidecar)) {
    fail(64, `receipt sidecar must be absent: ${sidecar}`);
  }
  const tmp = `${absPath}.tmp.${process.pid}`;
  const body = `${JSON.stringify(obj, null, 2)}\n`;
  writeFileSync(tmp, body, { flag: "wx" });
  renameSync(tmp, absPath);
  const fileHash = sha256File(absPath);
  writeFileSync(sidecar, `${fileHash}\n`, { flag: "wx" });
  return fileHash;
}

function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) fail(64, `unexpected arg ${a}`);
    const key = a.slice(2);
    const val = argv[++i];
    if (val === undefined) fail(64, `missing value for --${key}`);
    out[key] = val;
  }
  return out;
}

/**
 * Derive runner_contract checks + status from real step outcomes.
 * Never hard-codes PASS — each key is PASS only when its outcome.ok is true.
 * @param {Record<string, {ok: boolean, detail?: unknown}>} outcomes
 */
export function deriveRunnerContractChecks(outcomes) {
  /** @type {Record<string, "PASS"|"FAIL">} */
  const checks = {};
  for (const key of RUNNER_CHECK_KEYS) {
    const o = outcomes[key];
    checks[key] = o && o.ok === true ? "PASS" : "FAIL";
  }
  const runner_contract_status = RUNNER_CHECK_KEYS.every(
    (k) => checks[k] === "PASS",
  )
    ? "PASS"
    : "FAIL";
  return { checks, runner_contract_status };
}

/**
 * Strict evaluation of a `node --test` run via TAP footer counts.
 * Uses only the summary lines (`# tests N` / `# pass` / `# fail` / …) so
 * fixture text inside unit tests (e.g. the phrase "No tests") cannot
 * false-fail the runner contract the way a full-body strict scan would.
 *
 * @param {{code:number, stdout:string, stderr:string}} r
 * @returns {{ok: boolean, reason: string, counts: Record<string, number|null>}}
 */
export function evaluateNodeTestTap(r) {
  const text = `${r.stdout ?? ""}\n${r.stderr ?? ""}`;
  const grab = (re) => {
    const m = text.match(re);
    return m ? Number(m[1]) : null;
  };
  const counts = {
    total: grab(/#\s*tests\s+(\d+)/i),
    passed: grab(/#\s*pass\s+(\d+)/i),
    failed: grab(/#\s*fail\s+(\d+)/i),
    skipped: grab(/#\s*skipped\s+(\d+)/i) ?? grab(/#\s*skip\s+(\d+)/i),
    cancelled: grab(/#\s*cancelled\s+(\d+)/i),
    todo: grab(/#\s*todo\s+(\d+)/i),
  };
  if (r.code !== 0) {
    return { ok: false, reason: "nonzero_exit", counts };
  }
  if (counts.total === null) {
    return { ok: false, reason: "unparseable_tap_summary", counts };
  }
  if (counts.total === 0) {
    return { ok: false, reason: "zero_tests", counts };
  }
  if ((counts.failed ?? 0) > 0) {
    return { ok: false, reason: "failed_tests", counts };
  }
  if ((counts.skipped ?? 0) > 0) {
    return { ok: false, reason: "skipped_tests", counts };
  }
  if ((counts.cancelled ?? 0) > 0) {
    return { ok: false, reason: "cancelled_tests", counts };
  }
  if ((counts.todo ?? 0) > 0) {
    return { ok: false, reason: "todo_tests", counts };
  }
  if (counts.passed !== null && counts.passed < counts.total) {
    return { ok: false, reason: "pass_lt_total", counts };
  }
  return { ok: true, reason: "tap_strict_pass", counts };
}

/**
 * Ephemeral production-safe auth env for mirror API/web start (not ambient secrets).
 * @param {{webPort: number, apiPort: number}} lease
 */
export function makeProductionRuntimeSecrets(lease) {
  const apiKey = `api_${randomBytes(24).toString("hex")}`;
  const financeKey = `fin_${randomBytes(24).toString("hex")}`;
  const jwt = randomBytes(32).toString("hex");
  return {
    NODE_ENV: "production",
    SANGFOR_PROCESS_PROFILE: "production",
    HOST: "127.0.0.1",
    API_PORT: String(lease.apiPort),
    PORT: String(lease.webPort),
    API_KEY: apiKey,
    FINANCE_API_KEY: financeKey,
    SANGFOR_API_KEY: apiKey,
    MCP_API_KEY: apiKey,
    SANGFOR_OPERATOR_PRINCIPAL_ID: "u007-runner-contract-operator",
    WHELP99_ENFORCE_SAFE_TOOLS: "true",
    JWT_SECRET: jwt,
    NEXTAUTH_SECRET: jwt,
    NEXTAUTH_URL: `http://127.0.0.1:${lease.webPort}`,
    AUTH_BYPASS_ENABLED: "0",
    AUTH_PROFILE: "production",
    API_KEY_BYPASS_ENABLED: "0",
  };
}

/**
 * @param {{code:number, stdout:string, stderr:string}} r
 */
function offlineInstallBlockReason(r) {
  const text = `${r.stdout}\n${r.stderr}`;
  if (
    /ERR_PNPM_NO_OFFLINE_TARBALL|ERR_PNPM_NO_OFFLINE_META|not found in the store|Failed to resolve|ENOTFOUND|ECONNREFUSED|network/i.test(
      text,
    )
  ) {
    const pkg =
      text.match(/Package\s+([^\s]+)\s+not found/i)?.[1] ||
      text.match(/([@a-z0-9._/-]+)(?::|@)[^\s]*\s+not found in the store/i)?.[1] ||
      text.match(/ERR_PNPM_[A-Z_]+\s+([^\n]+)/i)?.[1] ||
      "unknown-missing-or-network";
    return `BLOCKED offline install: ${pkg}`;
  }
  return null;
}

/**
 * Spawn a long-lived process (not via spawnInMirror which waits for exit).
 * @param {string[]} argv
 * @param {{cwd:string, env:NodeJS.ProcessEnv}} opts
 */
function spawnDetached(argv, opts) {
  const [cmd, ...args] = argv;
  const child = spawn(cmd, args, {
    shell: false,
    cwd: opts.cwd,
    env: opts.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
    waitClose: () =>
      new Promise((resolvePromise) => {
        child.on("close", (code, signal) => {
          resolvePromise({
            code: code === null || code === undefined ? null : code,
            signal: signal ?? null,
            stdout,
            stderr,
          });
        });
      }),
  };
}

/**
 * Count docker resources labeled with a run id (must be 0 after cleanup).
 * @param {string} runId
 */
async function countLabeledDockerResources(runId) {
  const filter = `label=${LABEL_RUN}=${runId}`;
  const kinds = ["ps", "network", "volume"];
  let total = 0;
  /** @type {Record<string, number>} */
  const byKind = {};
  for (const kind of kinds) {
    const argv =
      kind === "ps"
        ? ["docker", "ps", "-aq", "--filter", filter]
        : ["docker", kind, "ls", "-q", "--filter", filter];
    const r = await new Promise((resolvePromise) => {
      const child = spawn(argv[0], argv.slice(1), {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (d) => (stdout += d));
      child.on("close", (code) => {
        resolvePromise({ code: code ?? 1, stdout });
      });
    });
    const n = r.stdout
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean).length;
    byKind[kind] = n;
    total += n;
  }
  return { total, byKind };
}

/**
 * Real in-mirror runner-contract phase.
 * Each of the 8 checks is derived from an actual action (or explicit inject for tests).
 *
 * @param {{
 *   mirrorRoot: string,
 *   candidateSha: string,
 *   spawnInMirror: (argv: string[], env?: NodeJS.ProcessEnv) => Promise<{code:number,stdout:string,stderr:string}>,
 *   makeChildEnv: (lane?: string, explicit?: Record<string,string>) => Record<string,string>,
 * }} ctx
 * @param {{
 *   runId: string,
 *   ownerUnit: string,
 *   attemptDir: string,
 *   resourceLeaseFile: string,
 *   lease: {webPort:number, apiPort:number, runId:string, ownerUnit:string},
 *   lock: {manifestListDigest: string, resolvedImage: string},
 *   releaseManifestSha256: string,
 *   releaseSchemaSha256: string,
 *   falseGreenScan?: ReturnType<typeof scanFalseGreenTests>,
 *   inject?: Partial<Record<string, {ok: boolean, detail?: unknown}>>,
 * }} opts
 */
export async function executeU007RunnerContract(ctx, opts) {
  const {
    mirrorRoot,
    spawnInMirror,
    makeChildEnv,
  } = ctx;
  const {
    runId,
    ownerUnit,
    attemptDir,
    resourceLeaseFile,
    lease,
    lock,
    releaseManifestSha256,
    releaseSchemaSha256,
    falseGreenScan,
    inject = {},
  } = opts;

  /** @type {Record<string, {ok: boolean, detail?: unknown, blocked?: string|null}>} */
  const outcomes = {};
  /** @type {Record<string, object>} */
  const installs = {};
  /** @type {object|null} */
  let build = null;
  /** @type {object|null} */
  let start = null;
  /** @type {object|null} */
  let playwright = null;
  /** @type {string[]} */
  const notes = [];

  // Preflight product false-green scan (mirror tree) — product RED_EXPECTED path
  const scan = falseGreenScan ?? scanFalseGreenTests(mirrorRoot);
  const uiBlocker = scan.findings.find((f) => f.name === "@sangfor/ui");
  if (!uiBlocker) {
    fail(64, "pre-U030 expected @sangfor/ui false-green blocker not found");
  }

  // ── 1. Frozen OFFLINE install (root / engineer / workflow) ──────────────
  let installsOk = true;
  /** @type {string|null} */
  let installBlocked = null;
  if (inject.installs) {
    installsOk = inject.installs.ok === true;
    installBlocked = inject.installs.blocked ?? null;
    installs._injected = inject.installs.detail ?? { ok: installsOk };
  } else {
    for (const scope of INSTALL_SCOPES) {
      const argv = [
        "bash",
        "scripts/run-workspace-runtime.sh",
        scope,
        "--",
        "corepack",
        "pnpm",
        "install",
        "--frozen-lockfile",
        "--prefer-offline",
      ];
      const started = Date.now();
      process.stderr.write(`WORKING: frozen offline install (${scope})\n`);
      const r = await spawnInMirror(argv, makeChildEnv("install"));
      const durationMs = Date.now() - started;
      const blocked = r.code !== 0 ? offlineInstallBlockReason(r) : null;
      installs[scope] = {
        argv,
        code: r.code,
        durationMs,
        blocked,
        stderrTail: (r.stderr || "").slice(-2000),
      };
      if (r.code !== 0) {
        installsOk = false;
        if (blocked) installBlocked = blocked;
        notes.push(`install ${scope} exit ${r.code}`);
      }
    }
  }
  if (installBlocked) notes.push(installBlocked);

  // ── 2. manifest15Lanes (contract validation, not product lanes) ─────────
  if (inject.manifest15Lanes) {
    outcomes.manifest15Lanes = inject.manifest15Lanes;
  } else {
    process.stderr.write("WORKING: manifest15Lanes contract validation\n");
    try {
      const manifestPath = join(mirrorRoot, "scripts/release-gate.manifest.json");
      const schemaPath = join(
        mirrorRoot,
        "scripts/release-gate.manifest.schema.json",
      );
      if (!existsSync(manifestPath) || !existsSync(schemaPath)) {
        throw new Error("manifest/schema missing in mirror");
      }
      const manifestSha = sha256File(manifestPath);
      const schemaSha = sha256File(schemaPath);
      if (manifestSha !== releaseManifestSha256) {
        throw new Error(
          `manifest sha mismatch mirror=${manifestSha} pin=${releaseManifestSha256}`,
        );
      }
      if (schemaSha !== releaseSchemaSha256) {
        throw new Error(
          `schema sha mismatch mirror=${schemaSha} pin=${releaseSchemaSha256}`,
        );
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
      if (schema.additionalProperties !== false) {
        throw new Error("schema must set additionalProperties false");
      }
      if (!schema.required || !schema.required.includes("schemaVersion")) {
        throw new Error("schema required fields missing schemaVersion");
      }
      validateManifestSemantics(manifest);
      outcomes.manifest15Lanes = {
        ok: true,
        detail: { manifestSha, schemaSha, steps: manifest.steps.length },
      };
    } catch (err) {
      outcomes.manifest15Lanes = {
        ok: false,
        detail: {
          error: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }

  // ── 3a. strictResultParser ──────────────────────────────────────────────
  if (inject.strictResultParser) {
    outcomes.strictResultParser = inject.strictResultParser;
  } else if (!installsOk) {
    outcomes.strictResultParser = {
      ok: false,
      detail: { reason: "skipped_install_failed", installBlocked },
    };
  } else {
    process.stderr.write("WORKING: strictResultParser unit tests\n");
    const argv = [
      "bash",
      "scripts/run-workspace-runtime.sh",
      "root",
      "--",
      "node",
      "--test",
      ...STRICT_PARSER_TESTS,
      ...OTHER_RUNNER_UNIT_TESTS,
    ];
    const r = await spawnInMirror(argv, makeChildEnv("generic"));
    const verdict = evaluateNodeTestTap(r);
    outcomes.strictResultParser = {
      ok: verdict.ok,
      detail: {
        exitCode: r.code,
        reason: verdict.reason,
        counts: verdict.counts,
      },
    };
  }

  // ── 3b. falseGreenFixtures ──────────────────────────────────────────────
  if (inject.falseGreenFixtures) {
    outcomes.falseGreenFixtures = inject.falseGreenFixtures;
  } else if (!installsOk) {
    outcomes.falseGreenFixtures = {
      ok: false,
      detail: { reason: "skipped_install_failed", installBlocked },
    };
  } else {
    process.stderr.write("WORKING: falseGreenFixtures unit tests\n");
    const argv = [
      "bash",
      "scripts/run-workspace-runtime.sh",
      "root",
      "--",
      "node",
      "--test",
      ...FALSE_GREEN_FIXTURE_TESTS,
    ];
    const r = await spawnInMirror(argv, makeChildEnv("generic"));
    const verdict = evaluateNodeTestTap(r);
    outcomes.falseGreenFixtures = {
      ok: verdict.ok,
      detail: {
        exitCode: r.code,
        reason: verdict.reason,
        counts: verdict.counts,
      },
    };
  }

  // ── 4. sanitizedEnv probe ───────────────────────────────────────────────
  if (inject.sanitizedEnv) {
    outcomes.sanitizedEnv = inject.sanitizedEnv;
  } else {
    process.stderr.write("WORKING: sanitizedEnv probe\n");
    const env = makeChildEnv("install");
    const probe = await spawnInMirror(
      [
        process.execPath,
        "-e",
        "const b=['DATABASE_URL','HTTP_PROXY','HTTPS_PROXY','NODE_OPTIONS','TASK_RUN_ID']; if(b.some(k=>process.env[k])) process.exit(2); process.exit(0)",
      ],
      env,
    );
    outcomes.sanitizedEnv = {
      ok: probe.code === 0,
      detail: { exitCode: probe.code },
    };
  }

  // ── 5. scratchPostgres ──────────────────────────────────────────────────
  if (inject.scratchPostgres) {
    outcomes.scratchPostgres = inject.scratchPostgres;
  } else {
    process.stderr.write("WORKING: scratchPostgres real PG16 round-trip\n");
    const pgEvidence = join(attemptDir, "scratch-postgres");
    mkdirSync(pgEvidence, { recursive: true });
    const pgRunId = `${runId}-pg`;
    try {
      let observed = null;
      await withIsolatedPostgres(
        {
          runId: pgRunId,
          ownerUnit,
          purpose: "u007-runner-contract-pg",
          evidenceDir: pgEvidence,
          imageDigest: lock.manifestListDigest,
          migrate: false,
          repoRoot: mirrorRoot,
        },
        async (pgCtx) => {
          observed = {
            host: pgCtx.host,
            port: pgCtx.port,
            databaseName: pgCtx.databaseName,
            receiptPath: pgCtx.receiptPath,
            sentinel: pgCtx.sentinel,
          };
          if (pgCtx.host !== "127.0.0.1") {
            throw Object.assign(new Error(`non-loopback host ${pgCtx.host}`), {
              exitCode: 65,
            });
          }
          if (!pgCtx.sentinel || pgCtx.sentinel.runId !== pgRunId) {
            throw Object.assign(new Error("sentinel runId mismatch"), {
              exitCode: 65,
            });
          }
        },
      );
      const leftover = await countLabeledDockerResources(pgRunId);
      const receiptPath = join(pgEvidence, "postgres-receipt.json");
      const receiptOk =
        existsSync(receiptPath) &&
        JSON.parse(readFileSync(receiptPath, "utf8")).cleanupState === "cleaned";
      outcomes.scratchPostgres = {
        ok: leftover.total === 0 && receiptOk && observed !== null,
        detail: { observed, leftover, receiptOk, imageDigest: lock.manifestListDigest },
      };
    } catch (err) {
      let leftover = { total: -1, byKind: {} };
      try {
        leftover = await countLabeledDockerResources(pgRunId);
      } catch {
        // ignore
      }
      outcomes.scratchPostgres = {
        ok: false,
        detail: {
          error: err instanceof Error ? err.message : String(err),
          leftover,
        },
      };
    }
  }

  // ── 6. apiProductionStart ───────────────────────────────────────────────
  if (inject.apiProductionStart) {
    outcomes.apiProductionStart = inject.apiProductionStart;
    build = inject.apiProductionStart.detail?.build ?? null;
    start = inject.apiProductionStart.detail?.start ?? null;
  } else if (!installsOk) {
    outcomes.apiProductionStart = {
      ok: false,
      detail: { reason: "skipped_install_failed", installBlocked },
    };
  } else {
    process.stderr.write("WORKING: apiProductionStart build+health\n");
    const buildArgv = [
      "bash",
      "scripts/run-workspace-runtime.sh",
      "root",
      "--",
      "corepack",
      "pnpm",
      "--filter",
      "@sangfor/api",
      "build",
    ];
    const buildStarted = Date.now();
    const buildR = await spawnInMirror(buildArgv, makeChildEnv("build"));
    build = {
      argv: buildArgv,
      code: buildR.code,
      durationMs: Date.now() - buildStarted,
      stderrTail: (buildR.stderr || "").slice(-2000),
    };
    const distEntry = join(mirrorRoot, "apps/api/dist/index.mjs");
    if (buildR.code !== 0 || !existsSync(distEntry)) {
      outcomes.apiProductionStart = {
        ok: false,
        detail: {
          reason: "build_failed",
          build,
          distExists: existsSync(distEntry),
        },
      };
    } else {
      const apiPort = lease.apiPort;
      const secrets = makeProductionRuntimeSecrets(lease);
      const startEnv = makeChildEnv("runtime", secrets);
      const startedAt = Date.now();
      // Start via workspace runtime so Node major matches the mirror install (20).
      const proc = spawnDetached(
        [
          "bash",
          join(mirrorRoot, "scripts/run-workspace-runtime.sh"),
          "root",
          "--",
          "node",
          "apps/api/dist/index.mjs",
        ],
        {
          cwd: mirrorRoot,
          env: startEnv,
        },
      );
      let healthStatus = null;
      let healthBody = null;
      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        if (proc.child.exitCode !== null) break;
        try {
          const res = await fetch(`http://127.0.0.1:${apiPort}/health`);
          healthStatus = res.status;
          if (res.status === 200) {
            healthBody = await res.json().catch(() => null);
            break;
          }
        } catch {
          // not up yet
        }
        await sleep(200);
      }
      proc.child.kill("SIGTERM");
      const closed = await Promise.race([
        proc.waitClose(),
        sleep(10_000).then(() => {
          try {
            proc.child.kill("SIGKILL");
          } catch {
            // ignore
          }
          return { code: -1, signal: "SIGKILL", stdout: "", stderr: "" };
        }),
      ]);
      // Listeners should be 0 after clean stop
      let listeners = -1;
      try {
        const lsof = spawnDetached(
          ["lsof", "-nP", `-iTCP:${apiPort}`, "-sTCP:LISTEN"],
          { cwd: mirrorRoot, env: makeChildEnv("generic") },
        );
        const lsofR = await Promise.race([
          lsof.waitClose(),
          sleep(3000).then(() => ({ code: 1, stdout: "", stderr: "" })),
        ]);
        listeners = (lsofR.stdout || "")
          .split("\n")
          .filter((l) => l.includes("LISTEN")).length;
      } catch {
        listeners = -1;
      }
      start = {
        argv: [
          "bash",
          "scripts/run-workspace-runtime.sh",
          "root",
          "--",
          "node",
          "apps/api/dist/index.mjs",
        ],
        apiPort,
        healthStatus,
        healthBody,
        exitCode: closed.code,
        signal: closed.signal ?? null,
        durationMs: Date.now() - startedAt,
        listeners,
        stderrTail: proc.getStderr().slice(-2000),
      };
      // Clean SIGTERM may surface as code 0, null, or 143; health 200 + listeners 0 is the contract.
      const cleanExit =
        closed.code === 0 ||
        closed.code === null ||
        closed.code === 143 ||
        closed.signal === "SIGTERM" ||
        closed.signal === "SIGKILL";
      outcomes.apiProductionStart = {
        ok: healthStatus === 200 && cleanExit && listeners === 0,
        detail: { build, start },
      };
    }
  }

  // ── 7. playwrightCoreFlow ───────────────────────────────────────────────
  if (inject.playwrightCoreFlow) {
    outcomes.playwrightCoreFlow = inject.playwrightCoreFlow;
    playwright = inject.playwrightCoreFlow.detail?.playwright ?? null;
  } else if (!installsOk) {
    outcomes.playwrightCoreFlow = {
      ok: false,
      detail: { reason: "skipped_install_failed", installBlocked },
    };
  } else {
    process.stderr.write(
      "WORKING: playwrightCoreFlow (dep+web build + core-flow)\n",
    );
    const pwEvidence = join(attemptDir, "playwright-evidence");
    mkdirSync(pwEvidence, { recursive: true });
    const pgEvidence = join(attemptDir, "playwright-postgres");
    mkdirSync(pgEvidence, { recursive: true });

    // Build web AND its workspace dependencies (fresh mirror has no package dist/).
    // pnpm `...` = package + recursive dependencies.
    const webBuildArgv = [
      "bash",
      "scripts/run-workspace-runtime.sh",
      "root",
      "--",
      "corepack",
      "pnpm",
      "--filter",
      "@sangfor/web...",
      "build",
    ];
    const webBuildStarted = Date.now();
    const webBuildR = await spawnInMirror(webBuildArgv, makeChildEnv("build"));
    const webBuild = {
      argv: webBuildArgv,
      code: webBuildR.code,
      durationMs: Date.now() - webBuildStarted,
      stderrTail: (webBuildR.stderr || "").slice(-2000),
    };

    // Ensure API dist present after dependency build graph
    const distEntry = join(mirrorRoot, "apps/api/dist/index.mjs");
    if (!existsSync(distEntry)) {
      const rebuild = await spawnInMirror(
        [
          "bash",
          "scripts/run-workspace-runtime.sh",
          "root",
          "--",
          "corepack",
          "pnpm",
          "--filter",
          "@sangfor/api",
          "build",
        ],
        makeChildEnv("build"),
      );
      if (rebuild.code !== 0) {
        playwright = {
          ok: false,
          reason: "api_build_missing_for_playwright",
          webBuild,
          rebuildCode: rebuild.code,
        };
        outcomes.playwrightCoreFlow = { ok: false, detail: { playwright } };
      }
    }

    if (!outcomes.playwrightCoreFlow) {
      if (webBuildR.code !== 0) {
        playwright = {
          ok: false,
          reason: "web_build_failed",
          webBuild,
        };
        outcomes.playwrightCoreFlow = { ok: false, detail: { playwright } };
      } else {
        // TASK_RUN_ID must match RESOURCE_LEASE_FILE.runId (acceptance env contract).
        // Scratch PG for playwright therefore reuses the lease runId (prior -pg scratch already cleaned).
        const pwRunId = runId;
        const pwArgv = [
          "bash",
          "scripts/run-workspace-runtime.sh",
          "root",
          "--",
          "node",
          "scripts/run-with-isolated-postgres.mjs",
          "--run-id",
          pwRunId,
          "--owner-unit",
          ownerUnit,
          "--purpose",
          "u007-runner-playwright",
          "--image-digest",
          lock.manifestListDigest,
          "--evidence-dir",
          pgEvidence,
          "--migrate",
          "--",
          "corepack",
          "pnpm",
          "test:acceptance",
          "--",
          "tests/e2e/playwright/core-flow-smoke.spec.ts",
        ];
        const pwStarted = Date.now();
        const secrets = makeProductionRuntimeSecrets(lease);
        const pwEnv = makeChildEnv("playwright", {
          ...secrets,
          PORT: String(lease.webPort),
          API_PORT: String(lease.apiPort),
          RESOURCE_LEASE_FILE: resourceLeaseFile,
          TASK_OWNER_UNIT: ownerUnit,
          TASK_RUN_ID: pwRunId,
          ACCEPTANCE_EVIDENCE_DIR: pwEvidence,
        });
        const pwR = await spawnInMirror(pwArgv, pwEnv);
        const durationMs = Date.now() - pwStarted;

        let report = null;
        let total = 0;
        let skipped = 0;
        let retries = 0;
        let flaky = 0;
        const reportPath = join(pwEvidence, "playwright-report.json");
        const receiptPath = join(pwEvidence, "playwright-receipt.json");
        const traceHint =
          existsSync(join(pwEvidence, "trace")) ||
          existsSync(join(mirrorRoot, "test-results"));
        if (existsSync(reportPath)) {
          try {
            report = JSON.parse(readFileSync(reportPath, "utf8"));
            const walk = (suite) => {
              for (const s of suite.suites ?? []) walk(s);
              for (const spec of suite.specs ?? []) {
                total += 1;
                for (const t of spec.tests ?? []) {
                  for (const r of t.results ?? []) {
                    if (r.status === "skipped") skipped += 1;
                    if ((r.retry ?? 0) > 0) retries += 1;
                    if (r.status === "flaky" || r.flaky) flaky += 1;
                  }
                }
              }
            };
            for (const s of report.suites ?? []) walk(s);
          } catch (err) {
            notes.push(
              `playwright report parse: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        const leftover = await countLabeledDockerResources(pwRunId);
        playwright = {
          argv: pwArgv,
          code: pwR.code,
          durationMs,
          total,
          skipped,
          retries,
          flaky,
          reportPresent: existsSync(reportPath),
          receiptPresent: existsSync(receiptPath),
          tracePresent: Boolean(traceHint),
          webBuild,
          leftover,
          stderrTail: (pwR.stderr || "").slice(-3000),
          stdoutTail: (pwR.stdout || "").slice(-3000),
        };
        outcomes.playwrightCoreFlow = {
          ok:
            pwR.code === 0 &&
            total > 0 &&
            skipped === 0 &&
            retries === 0 &&
            flaky === 0 &&
            leftover.total === 0,
          detail: { playwright },
        };
      }
    }
  }

  // detachedMirrorCleanup is filled by the caller after withDetachedReleaseMirror returns
  outcomes.detachedMirrorCleanup = inject.detachedMirrorCleanup ?? {
    ok: false,
    detail: { reason: "pending_outer_cleanup" },
  };

  const { checks, runner_contract_status } = deriveRunnerContractChecks(outcomes);

  return {
    scan,
    installs,
    build,
    start,
    playwright,
    outcomes,
    checks,
    runner_contract_status,
    notes,
    installBlocked,
    installsOk,
  };
}

/**
 * Enrich the helper-written mirror receipt with real installs/build/start/playwright.
 * (Helper hard-codes empty installs/nulls; U007 runner owns those fields.)
 */
function enrichMirrorReceipt(attemptDir, enrichment) {
  const path = join(attemptDir, "detached-release-mirror-receipt.json");
  if (!existsSync(path)) {
    fail(64, "detached-release-mirror-receipt.json missing after mirror");
  }
  const receipt = JSON.parse(readFileSync(path, "utf8"));
  receipt.installs = enrichment.installs ?? {};
  receipt.build = enrichment.build ?? null;
  receipt.start = enrichment.start ?? null;
  receipt.playwright = enrichment.playwright ?? null;
  if (enrichment.runner_contract_status === "FAIL") {
    receipt.result =
      receipt.cleanup?.status === "PASS" ? "RUNNER_CONTRACT_FAIL" : "FAIL";
  }
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return { receipt, sha256: sha256File(path) };
}

/**
 * @param {string[]} [argv]
 * @param {{
 *   inject?: Parameters<typeof executeU007RunnerContract>[1]["inject"],
 *   falseGreenScan?: Parameters<typeof executeU007RunnerContract>[1]["falseGreenScan"],
 *   withMirror?: typeof withDetachedReleaseMirror,
 * }} [deps] Test-only dependency injection (omit in production).
 */
export async function runDetachedReleaseMirrorMain(
  argv = process.argv.slice(2),
  deps = {},
) {
  const args = parseArgs(argv);
  const mode = args.mode;
  if (!MODES.has(mode)) {
    fail(64, `mode must be one of ${[...MODES].join("|")}`);
  }
  const candidateSha = args["candidate-sha"];
  const runId = args["run-id"];
  const ownerUnit = args["owner-unit"];
  const attemptDir = args["attempt-dir"];
  const resourceLeaseFile = args["resource-lease-file"];

  if (!candidateSha || !runId || !ownerUnit || !attemptDir || !resourceLeaseFile) {
    fail(
      64,
      "required: --mode --candidate-sha --run-id --owner-unit --attempt-dir --resource-lease-file",
    );
  }

  if (mode === "u007-release" && ownerUnit !== "U007") {
    fail(64, "u007-release requires --owner-unit U007");
  }
  if (mode === "u030-post-release") {
    if (ownerUnit !== "U030") fail(64, "u030-post-release requires U030");
    for (const k of ["previous-product", "inventory", "u029"]) {
      if (!args[k]) fail(64, `u030-post-release requires --${k}`);
    }
  } else {
    for (const k of ["previous-product", "inventory", "u029"]) {
      if (args[k]) fail(64, `${mode} rejects --${k}`);
    }
  }
  if (mode === "u076-final-aliases" && ownerUnit !== "U076") {
    fail(64, "u076-final-aliases requires U076");
  }

  const absAttempt = resolve(attemptDir);
  mkdirSync(absAttempt, { recursive: true });

  const lease = loadAndValidateResourceLease(resourceLeaseFile, {
    expectedOwnerUnit: ownerUnit,
    expectedRunId: runId,
  });

  const lock = loadAndMatchImageLock({
    imageDigest: JSON.parse(readFileSync(DEFAULT_LOCK, "utf8")).manifestListDigest,
    lockPath: DEFAULT_LOCK,
  });

  const manifestPath = join(REPO_ROOT, "scripts/release-gate.manifest.json");
  const schemaPath = join(REPO_ROOT, "scripts/release-gate.manifest.schema.json");
  const releaseManifestSha256 = sha256File(manifestPath);
  const releaseSchemaSha256 = sha256File(schemaPath);

  if (mode === "u007-release") {
    const withMirror = deps.withMirror ?? withDetachedReleaseMirror;
    process.stderr.write(
      `WORKING: u007-release mirror lifecycle candidate=${candidateSha}\n`,
    );

    const { result: contract } = await withMirror(
      {
        candidateSha,
        runId,
        ownerUnit,
        attemptDir: absAttempt,
        mode,
      },
      async (ctx) =>
        executeU007RunnerContract(ctx, {
          runId,
          ownerUnit,
          attemptDir: absAttempt,
          resourceLeaseFile: resolve(resourceLeaseFile),
          lease,
          lock,
          releaseManifestSha256,
          releaseSchemaSha256,
          falseGreenScan: deps.falseGreenScan,
          inject: deps.inject,
        }),
    );

    // Mirror helper has cleaned up — set cleanup check from real receipt
    const rawReceiptPath = join(
      absAttempt,
      "detached-release-mirror-receipt.json",
    );
    const rawReceipt = JSON.parse(readFileSync(rawReceiptPath, "utf8"));
    if (!deps.inject?.detachedMirrorCleanup) {
      contract.outcomes.detachedMirrorCleanup = {
        ok: rawReceipt.cleanup?.status === "PASS",
        detail: rawReceipt.cleanup,
      };
      const derived = deriveRunnerContractChecks(contract.outcomes);
      contract.checks = derived.checks;
      contract.runner_contract_status = derived.runner_contract_status;
    }

    const { receipt: mirrorReceipt, sha256: mirrorReceiptSha } =
      enrichMirrorReceipt(absAttempt, {
        installs: contract.installs,
        build: contract.build,
        start: contract.start,
        playwright: contract.playwright,
        runner_contract_status: contract.runner_contract_status,
      });

    const runnerReceipt = {
      schemaVersion: 1,
      receiptKind: "runner_contract",
      phase: "pre_u030",
      unit: "U007",
      runId,
      candidateSha,
      releaseManifestSha256,
      releaseSchemaSha256,
      detachedMirrorReceiptSha256: mirrorReceiptSha,
      checks: contract.checks,
      runner_contract_status: contract.runner_contract_status,
      createdAt: new Date().toISOString(),
    };
    // Attach diagnostic notes only for FAIL (not part of success schema)
    if (contract.runner_contract_status !== "PASS") {
      runnerReceipt.notes = contract.notes;
      runnerReceipt.outcomes = Object.fromEntries(
        Object.entries(contract.outcomes).map(([k, v]) => [
          k,
          { ok: v.ok, detail: v.detail },
        ]),
      );
      if (contract.installBlocked) {
        runnerReceipt.blocked = contract.installBlocked;
      }
    }

    // Success schema forbids extra keys — strip diagnostics on PASS
    const runnerForPublish =
      contract.runner_contract_status === "PASS"
        ? {
            schemaVersion: 1,
            receiptKind: "runner_contract",
            phase: "pre_u030",
            unit: "U007",
            runId,
            candidateSha,
            releaseManifestSha256,
            releaseSchemaSha256,
            detachedMirrorReceiptSha256: mirrorReceiptSha,
            checks: contract.checks,
            runner_contract_status: "PASS",
            createdAt: runnerReceipt.createdAt,
          }
        : runnerReceipt;

    const runnerHash = publishReceipt(
      join(absAttempt, "runner-contract-receipt.json"),
      runnerForPublish,
    );

    // Product path: RED_EXPECTED at @sangfor/ui — unchanged semantics
    const releaseReport = {
      stoppedAt: "preflight",
      blockers: [
        {
          code: "FALSE_GREEN_TEST_SCRIPT",
          package: "@sangfor/ui",
          path: "packages/ui/package.json",
          script: "echo No tests",
        },
      ],
    };
    const releaseReportSha256 = sha256Text(JSON.stringify(releaseReport));

    const productReceipt = {
      schemaVersion: 1,
      receiptKind: "product_release",
      phase: "pre_u030",
      unit: "U007",
      runId,
      candidateSha,
      runnerContractReceiptSha256: runnerHash,
      previousProductReleaseReceiptSha256: null,
      u008InventoryReceiptSha256: null,
      u029ReceiptSha256: null,
      releaseManifestSha256,
      releaseSchemaSha256,
      product_release_status: "RED_EXPECTED",
      preflightBlockers: [
        {
          code: "FALSE_GREEN_TEST_SCRIPT",
          package: "@sangfor/ui",
          path: "packages/ui/package.json",
          script: "echo No tests",
        },
      ],
      completedStepIds: [],
      failedStepIds: [],
      releaseExitCode: 64,
      outerExitCode:
        contract.runner_contract_status === "PASS" ? 78 : 65,
      releaseReportSha256,
      cleanupStatus:
        mirrorReceipt.cleanup?.status === "PASS" ? "PASS" : "FAIL",
      createdAt: new Date().toISOString(),
    };
    publishReceipt(join(absAttempt, "product-release-receipt.json"), productReceipt);

    writeFileSync(
      join(absAttempt, "receipt.json"),
      JSON.stringify(
        {
          outerExitCode:
            contract.runner_contract_status === "PASS" ? 78 : 65,
          runner_contract_status: contract.runner_contract_status,
          product_release_status: "RED_EXPECTED",
          runnerContractReceipt: "runner-contract-receipt.json",
          productReleaseReceipt: "product-release-receipt.json",
          runnerContractReceiptSha256: runnerHash,
          note:
            contract.runner_contract_status === "PASS"
              ? "pre-U030 dependency closure; exit 78 is expected"
              : "runner_contract FAILED — exit 65 (not 78); product still RED_EXPECTED",
          checks: contract.checks,
          installBlocked: contract.installBlocked ?? null,
        },
        null,
        2,
      ),
    );

    if (contract.runner_contract_status === "PASS") {
      process.exit(78);
    }
    process.stderr.write(
      `runner_contract_status=FAIL checks=${JSON.stringify(contract.checks)}\n`,
    );
    if (contract.installBlocked) {
      process.stderr.write(`${contract.installBlocked}\n`);
    }
    process.exit(65);
  }

  if (mode === "u030-post-release") {
    fail(64, "u030-post-release not executable in this worktree phase (U030 card)");
  }
  if (mode === "u076-final-aliases") {
    for (const key of ["FINAL_CANDIDATE_SHA", "FINAL_ALIAS_LEASE_MAP", "SCM_HANDOFF_FILE", "TASK_RUN_ID", "TASK_OWNER_UNIT", "PORT", "API_PORT", "ACCEPTANCE_EVIDENCE_DIR", "RESOURCE_LEASE_FILE"]) {
      if (!process.env[key]) fail(64, `u076-final-aliases requires ${key}`);
    }
    if (
      process.env.FINAL_CANDIDATE_SHA !== candidateSha ||
      process.env.TASK_RUN_ID !== runId ||
      process.env.TASK_OWNER_UNIT !== "U076" ||
      resolve(process.env.RESOURCE_LEASE_FILE) !== resolve(resourceLeaseFile)
    ) {
      fail(64, "u076-final-aliases command/environment identity mismatch");
    }
    const handoff = validateScmHandoff(process.env.SCM_HANDOFF_FILE, candidateSha);
    const sourceHead = await spawnCapture(["git", "rev-parse", "HEAD"]);
    const sourceStatus = await spawnCapture(["git", "status", "--porcelain=v1", "--untracked-files=all"]);
    if (sourceHead.code !== 0 || sourceHead.stdout.trim() !== candidateSha || sourceStatus.code !== 0 || sourceStatus.stdout !== "") {
      fail(64, "u076-final-aliases requires clean source HEAD equal to candidate SHA");
    }
    const withMirror = deps.withMirror ?? withDetachedReleaseMirror;
    const mirrorRun = await withMirror(
      { candidateSha, runId, ownerUnit, attemptDir: absAttempt, mode },
      async (ctx) => {
        for (const scope of INSTALL_SCOPES) {
          const install = await ctx.spawnInMirror(
            ["bash", "scripts/run-workspace-runtime.sh", scope, "--", "corepack", "pnpm", "install", "--frozen-lockfile", "--prefer-offline"],
            ctx.makeChildEnv("install"),
          );
          if (install.code !== 0) abort(66, `u076 ${scope} frozen install failed: ${install.stderr.slice(-2000)}`);
        }
        const inner = await ctx.spawnInMirror(
          finalAcceptanceInnerArgv(ctx.mirrorContextFile, ctx.mirrorContextHash),
          ctx.makeChildEnv("generic", {
            U076_AUTHORITATIVE: "1",
            FINAL_CANDIDATE_SHA: candidateSha,
            FINAL_ALIAS_LEASE_MAP: resolve(process.env.FINAL_ALIAS_LEASE_MAP),
            TASK_RUN_ID: runId,
            TASK_OWNER_UNIT: "U076",
            PORT: String(lease.webPort),
            API_PORT: String(lease.apiPort),
            ACCEPTANCE_EVIDENCE_DIR: resolve(process.env.ACCEPTANCE_EVIDENCE_DIR),
            RESOURCE_LEASE_FILE: resolve(resourceLeaseFile),
          }),
        );
        if (inner.code !== 0) abort(65, `U076 inner acceptance failed: ${inner.stderr.slice(-4000)}`);
        const lines = inner.stdout.split("\n").filter((line) => line.startsWith("U076_INNER_SUMMARY="));
        if (lines.length !== 1) abort(64, "U076 inner summary marker missing or duplicated");
        const summary = JSON.parse(lines[0].slice("U076_INNER_SUMMARY=".length));
        if (summary.candidateSha !== candidateSha || summary.state !== "LOCAL_PASS_EXTERNAL_PENDING" || summary.autonomousPassed !== 98 || summary.manualPending !== 1) {
          abort(64, "U076 inner summary identity/state mismatch");
        }
        return summary;
      },
    );
    const innerSummaryFile = join(absAttempt, "mirror-internal-summary.json");
    const mirrorReceiptFile = join(absAttempt, "detached-release-mirror-receipt.json");
    const mirrorReceipt = JSON.parse(readFileSync(mirrorReceiptFile, "utf8"));
    if (mirrorReceipt.cleanup?.status !== "PASS" || mirrorReceipt.result !== "PASS") {
      fail(64, "U076 detached mirror cleanup did not PASS");
    }
    const envelope = {
      schemaVersion: 1,
      unit: "U076",
      candidateSha,
      runId,
      state: "LOCAL_PASS_EXTERNAL_PENDING",
      autonomousPassed: 98,
      manualPending: 1,
      innerSummarySha256: sha256File(innerSummaryFile),
      detachedMirrorReceiptSha256: sha256File(mirrorReceiptFile),
      scmHandoffSha256: handoff.sha256,
      cleanup: "PASS",
      createdAt: new Date().toISOString(),
    };
    const temporary = join(absAttempt, "final-acceptance.json.tmp");
    writeFileSync(temporary, `${JSON.stringify(envelope, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, join(absAttempt, "final-acceptance.json"));
    process.stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
    return mirrorRun.result;
  }
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runDetachedReleaseMirrorMain().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.stack ?? err.message : String(err)}\n`,
    );
    process.exit(err?.exitCode ?? 65);
  });
}
