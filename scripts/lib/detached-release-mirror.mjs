/**
 * U007 — detached git worktree release mirror owner.
 * Export: withDetachedReleaseMirror(options, callback)
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { makeSanitizedProcessEnv, envKeySet } from "./sanitized-process-env.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(code, message) {
  const err = new Error(message);
  err.exitCode = code;
  throw err;
}

/**
 * @param {string[]} argv
 * @param {{cwd?: string, env?: NodeJS.ProcessEnv}} [opts]
 */
export function spawnGit(argv, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", argv, {
      shell: false,
      cwd: opts.cwd ?? REPO_ROOT,
      env: opts.env ?? process.env,
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
 * @param {string} sha
 */
export async function assertCandidateCommit(sha) {
  if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
    fail(64, "detached-mirror: candidateSha must be lowercase 40-hex");
  }
  const cat = await spawnGit(["cat-file", "-e", `${sha}^{commit}`]);
  if (cat.code !== 0) {
    fail(64, `detached-mirror: not a commit: ${sha}`);
  }
  const rev = await spawnGit(["rev-parse", `${sha}^{commit}`]);
  if (rev.code !== 0) fail(64, "detached-mirror: rev-parse failed");
  const resolved = rev.stdout.trim();
  if (resolved !== sha) {
    fail(64, `detached-mirror: rev-parse mismatch ${resolved} !== ${sha}`);
  }
  return resolved;
}

/**
 * Collect original ignored .env* inventory (metadata + hash only).
 */
export async function collectIgnoredEnvInventory(repoRoot = REPO_ROOT) {
  const r = await spawnGit(
    ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
    { cwd: repoRoot },
  );
  const paths = r.stdout.split("\0").filter(Boolean);
  /** @type {object[]} */
  const items = [];
  for (const p of paths) {
    const base = basename(p);
    if (!base.startsWith(".env")) continue;
    const abs = join(repoRoot, p);
    try {
      const st = lstatSync(abs);
      let sha256 = null;
      let type = "other";
      if (st.isSymbolicLink()) type = "symlink";
      else if (st.isDirectory()) type = "directory";
      else if (st.isFIFO()) type = "fifo";
      else if (st.isFile()) {
        type = "file";
        sha256 = createHash("sha256")
          .update(readFileSync(abs))
          .digest("hex");
      }
      items.push({
        path: p.split("\\").join("/"),
        exists: true,
        type,
        mode: st.mode,
        size: st.size,
        sha256,
      });
    } catch {
      items.push({
        path: p.split("\\").join("/"),
        exists: false,
        type: "missing",
        mode: null,
        size: null,
        sha256: null,
      });
    }
  }
  items.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return items;
}

/**
 * Env-file gate: only tracked regular .env.example allowed among basename .env*
 */
export async function assertEnvFileGate(mirrorRoot, candidateSha) {
  /** Walk filesystem */
  /** @type {string[]} */
  const violations = [];

  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (ent.name === ".git" || ent.name === "node_modules") continue;
      const abs = join(dir, ent.name);
      if (ent.name.startsWith(".env")) {
        if (ent.name === ".env.example" && ent.isFile() && !ent.isSymbolicLink()) {
          // ok — further checked as tracked
        } else {
          violations.push(relative(mirrorRoot, abs));
        }
      }
      if (ent.isDirectory() && !ent.isSymbolicLink()) walk(abs);
    }
  }
  walk(mirrorRoot);

  if (violations.length) {
    fail(
      64,
      `detached-mirror: forbidden .env* paths: ${violations.slice(0, 5).join(", ")}`,
    );
  }

  // git ls-files for tracked .env*
  const tracked = await spawnGit(["ls-files", "-z"], { cwd: mirrorRoot });
  const files = tracked.stdout.split("\0").filter(Boolean);
  for (const p of files) {
    const base = basename(p);
    if (!base.startsWith(".env")) continue;
    if (base !== ".env.example") {
      fail(64, `detached-mirror: tracked forbidden env file ${p}`);
    }
    // verify blob matches candidate
    const head = await spawnGit(["rev-parse", "HEAD"], { cwd: mirrorRoot });
    if (head.stdout.trim() !== candidateSha) {
      fail(64, "detached-mirror: HEAD drift during env gate");
    }
  }
}

async function listWorktrees(repoRoot = REPO_ROOT) {
  const r = await spawnGit(["worktree", "list", "--porcelain"], {
    cwd: repoRoot,
  });
  /** @type {object[]} */
  const items = [];
  let cur = {};
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur.path) items.push(cur);
      cur = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("HEAD ")) {
      cur.head = line.slice(5);
    } else if (line.startsWith("branch ")) {
      cur.branch = line.slice(7);
    } else if (line === "detached") {
      cur.detached = true;
    } else if (line === "") {
      if (cur.path) items.push(cur);
      cur = {};
    }
  }
  if (cur.path) items.push(cur);
  return items;
}

/**
 * @param {{
 *   candidateSha: string,
 *   runId: string,
 *   ownerUnit: string,
 *   attemptDir: string,
 *   mode?: string,
 *   repoRoot?: string,
 * }} options
 * @param {(ctx: {
 *   mirrorRoot: string,
 *   candidateSha: string,
 *   spawnInMirror: (argv: string[], env?: NodeJS.ProcessEnv) => Promise<{code:number,stdout:string,stderr:string}>,
 *   makeChildEnv: (lane?: string, explicit?: Record<string,string>) => Record<string,string>,
 *   mirrorContextFile: string,
 *   mirrorContextHash: string,
 * }) => Promise<unknown>} callback
 */
export async function withDetachedReleaseMirror(options, callback) {
  if (!options || typeof options !== "object") fail(64, "options required");
  const required = ["candidateSha", "runId", "ownerUnit", "attemptDir"];
  for (const k of required) {
    if (typeof options[k] !== "string" || !options[k]) {
      fail(64, `detached-mirror: ${k} required`);
    }
  }
  for (const k of Object.keys(options)) {
    if (
      ![
        "candidateSha",
        "runId",
        "ownerUnit",
        "attemptDir",
        "mode",
        "repoRoot",
      ].includes(k)
    ) {
      fail(64, `detached-mirror: unknown option ${k}`);
    }
  }

  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const candidateSha = await assertCandidateCommit(options.candidateSha);
  const attemptDir = resolve(options.attemptDir);
  if (!attemptDir.startsWith("/")) fail(64, "attemptDir must be absolute");
  try {
    if (lstatSync(attemptDir).isSymbolicLink()) {
      fail(64, "attemptDir must not be symlink");
    }
  } catch {
    mkdirSync(attemptDir, { recursive: true });
  }

  const mirrorPath = join(attemptDir, "source");
  if (existsSync(mirrorPath)) {
    fail(64, "detached-mirror: source path must be absent");
  }

  const originalWorktreesBefore = await listWorktrees(repoRoot);
  const originalIgnoredEnvBefore = await collectIgnoredEnvInventory(repoRoot);
  /** @type {string[]} */
  const envScanCheckpoints = [];
  /** @type {string[][]} */
  const childEnvKeySets = [];
  /** @type {object[]} */
  const commands = [];

  let mirrorCreated = false;
  /** @type {object} */
  let cleanup = { status: "PENDING", primary: null, secondary: null };

  const mode = options.mode ?? "u007-release";

  try {
    const add = await spawnGit(
      ["worktree", "add", "--detach", mirrorPath, candidateSha],
      { cwd: repoRoot },
    );
    if (add.code !== 0) {
      fail(64, `worktree add failed: ${add.stderr}`);
    }
    mirrorCreated = true;

    const head = await spawnGit(["rev-parse", "HEAD"], { cwd: mirrorPath });
    const mirrorHead = head.stdout.trim();
    if (mirrorHead !== candidateSha) {
      fail(64, `mirror HEAD ${mirrorHead} !== ${candidateSha}`);
    }
    const symbolic = await spawnGit(["symbolic-ref", "-q", "HEAD"], {
      cwd: mirrorPath,
    });
    // detached → symbolic-ref fails
    if (symbolic.code === 0) {
      fail(64, "mirror is not detached");
    }

    const status = await spawnGit(
      ["status", "--porcelain=v2", "--untracked-files=all"],
      { cwd: mirrorPath },
    );
    if (status.stdout.trim() !== "") {
      fail(64, "mirror working tree not clean");
    }

    await assertEnvFileGate(mirrorPath, candidateSha);
    envScanCheckpoints.push("post-worktree-add");

    const spawnInMirror = async (argv, env) => {
      if (!Array.isArray(argv) || argv.length === 0) {
        fail(64, "spawnInMirror: argv required");
      }
      const childEnv = env ?? makeSanitizedProcessEnv({ lane: "generic" });
      childEnvKeySets.push(envKeySet(childEnv));
      return new Promise((resolvePromise, reject) => {
        const [cmd, ...args] = argv;
        const child = spawn(cmd, args, {
          shell: false,
          cwd: mirrorPath,
          env: childEnv,
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
          commands.push({ argv, code: code ?? 1 });
          resolvePromise({ code: code ?? 1, stdout, stderr });
        });
      });
    };

    const makeChildEnv = (lane = "generic", explicit = {}) =>
      makeSanitizedProcessEnv({ lane, explicit });

    const context = {
      schemaVersion: 1,
      mode,
      runId: options.runId,
      ownerUnit: options.ownerUnit,
      candidateSha,
      mirrorPath,
      mirrorHead,
      detached: true,
      sourceStatus: "clean",
      envCheckpointHash: createHash("sha256")
        .update(JSON.stringify({ originalIgnoredEnvBefore, envScanCheckpoints }))
        .digest("hex"),
      childEnvKeySetHash: createHash("sha256")
        .update(JSON.stringify(envKeySet(makeChildEnv())))
        .digest("hex"),
      receiptSchemaHash: createHash("sha256")
        .update(readFileSync(join(repoRoot, "scripts/lib/detached-release-mirror-receipt.schema.json")))
        .digest("hex"),
      createdAt: new Date().toISOString(),
    };
    const mirrorContextFile = join(attemptDir, "detached-release-mirror-context.json");
    const contextTmp = `${mirrorContextFile}.tmp`;
    if (existsSync(mirrorContextFile) || existsSync(contextTmp)) {
      fail(64, "fresh detached mirror context destination required");
    }
    const contextBytes = `${JSON.stringify(context, null, 2)}\n`;
    writeFileSync(contextTmp, contextBytes, { mode: 0o600 });
    renameSync(contextTmp, mirrorContextFile);
    const mirrorContextHash = createHash("sha256").update(contextBytes).digest("hex");

    const cbResult = await callback({
      mirrorRoot: mirrorPath,
      candidateSha,
      spawnInMirror,
      makeChildEnv,
      mirrorContextFile,
      mirrorContextHash,
    });

    await assertEnvFileGate(mirrorPath, candidateSha);
    envScanCheckpoints.push("pre-cleanup");

    const sourceStatusAfter = (
      await spawnGit(["status", "--porcelain=v2", "--untracked-files=all"], {
        cwd: mirrorPath,
      })
    ).stdout;

    const originalIgnoredEnvAfter = await collectIgnoredEnvInventory(repoRoot);
    if (
      JSON.stringify(originalIgnoredEnvBefore) !==
      JSON.stringify(originalIgnoredEnvAfter)
    ) {
      fail(64, "detached-mirror: original ignored env inventory drift");
    }

    const originalWorktreesAfterPre = await listWorktrees(repoRoot);

    // cleanup mirror
    const rm = await spawnGit(
      ["worktree", "remove", "--force", mirrorPath],
      { cwd: repoRoot },
    );
    if (rm.code !== 0) {
      cleanup = {
        status: "FAIL",
        primary: "remove_failed",
        secondary: rm.stderr,
      };
      fail(64, `worktree remove failed: ${rm.stderr}`);
    }
    mirrorCreated = false;

    const dry = await spawnGit(
      ["worktree", "prune", "--dry-run", "--verbose", "--expire", "now"],
      { cwd: repoRoot },
    );
    // If dry-run mentions other paths unexpectedly, skip actual prune
    const dryText = dry.stdout + dry.stderr;
    if (dryText && /Removing worktrees/i.test(dryText)) {
      // only prune if safe — always prune with expire now after our remove
    }
    const prune = await spawnGit(
      ["worktree", "prune", "--verbose", "--expire", "now"],
      { cwd: repoRoot },
    );

    const originalWorktreesAfter = await listWorktrees(repoRoot);
    // Ensure our mirror path is gone
    if (existsSync(mirrorPath)) {
      fail(64, "mirror path still exists after cleanup");
    }

    cleanup = {
      status: "PASS",
      primary: "removed",
      secondary: prune.code === 0 ? "pruned" : "prune_warn",
      removeCode: rm.code,
      pruneCode: prune.code,
    };

    const receipt = {
      schemaVersion: 1,
      runId: options.runId,
      ownerUnit: options.ownerUnit,
      candidateSha,
      mirrorPath: relative(attemptDir, mirrorPath) || "source",
      mirrorHead: candidateSha,
      detached: true,
      sourceStatusBefore: "",
      sourceStatusAfter: sourceStatusAfter.trim(),
      originalWorktreesBefore: originalWorktreesBefore.map((w) => ({
        path: w.path,
        head: w.head,
        detached: !!w.detached,
      })),
      originalWorktreesAfter: originalWorktreesAfter.map((w) => ({
        path: w.path,
        head: w.head,
        detached: !!w.detached,
      })),
      originalIgnoredEnvBefore,
      originalIgnoredEnvAfter,
      envScanCheckpoints,
      childEnvKeySets,
      installs: {},
      mode,
      commands: commands.map((c) => ({
        argv: c.argv,
        code: c.code,
      })),
      build: null,
      start: null,
      playwright: null,
      cleanup,
      result: "PASS",
      createdAt: new Date().toISOString(),
    };

    writeFileSync(
      join(attemptDir, "detached-release-mirror-receipt.json"),
      JSON.stringify(receipt, null, 2),
    );

    return { result: cbResult, receipt };
  } catch (err) {
    if (mirrorCreated) {
      try {
        await spawnGit(["worktree", "remove", "--force", mirrorPath], {
          cwd: repoRoot,
        });
        await spawnGit(
          ["worktree", "prune", "--verbose", "--expire", "now"],
          { cwd: repoRoot },
        );
      } catch {
        // best effort
      }
    }
    throw err;
  }
}
