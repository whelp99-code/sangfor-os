/**
 * U003 — run-workspace-runtime.sh fixtures (node --test, Node 20)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const WRAPPER = join(REPO, "scripts", "run-workspace-runtime.sh");

/** @type {string[]} */
const TEMP_DIRS = [];
/** @type {number[]} */
const CHILD_PIDS = [];

function makeTemp() {
  const d = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "sangfor-u003."));
  TEMP_DIRS.push(d);
  return d;
}

function cleanupAll() {
  for (const pid of CHILD_PIDS.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ESRCH ok */
    }
  }
  for (const d of TEMP_DIRS.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    assert.equal(existsSync(d), false, `temp dir still exists: ${d}`);
  }
}

process.on("exit", cleanupAll);
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanupAll();
    process.exit(128 + (sig === "SIGINT" ? 2 : 15));
  });
}

function runWrapper(args, opts = {}) {
  const env = { ...process.env, ...(opts.env || {}) };
  // Strip FORCE_COLOR noise for deterministic stderr when needed
  const r = spawnSync("bash", [WRAPPER, ...args], {
    cwd: opts.cwd ?? REPO,
    env,
    encoding: "utf8",
    timeout: opts.timeout ?? 60_000,
  });
  return r;
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n");
}

function scaffoldWorkspace(root, { name, nvmrc, packageManager = "pnpm@10.28.1" }) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, ".nvmrc"), `${nvmrc}\n`);
  writeJson(join(root, "package.json"), {
    name,
    version: "0.0.0",
    private: true,
    packageManager,
  });
}

/** Fake repo with three workspaces + copied wrapper for drift fixtures. */
function makeFakeRepo({ rootNvm = "20", engNvm = "20", wfNvm = "22", rootName, engName, wfName } = {}) {
  const base = makeTemp();
  mkdirSync(join(base, "scripts"), { recursive: true });
  const wrapperDst = join(base, "scripts", "run-workspace-runtime.sh");
  copyFileSync(WRAPPER, wrapperDst);
  chmodSync(wrapperDst, 0o755);
  scaffoldWorkspace(base, {
    name: rootName ?? "sangfor-agentic-os",
    nvmrc: rootNvm,
  });
  scaffoldWorkspace(join(base, "services", "sangfor-engineer-mcp"), {
    name: engName ?? "sangfor-engineer-mcp",
    nvmrc: engNvm,
  });
  scaffoldWorkspace(join(base, "services", "sangfor-mcp-workflow"), {
    name: wfName ?? "sangfor-mcp-workflow",
    nvmrc: wfNvm,
  });
  return { base, wrapper: wrapperDst };
}

function runFake(wrapper, args, opts = {}) {
  return spawnSync("bash", [wrapper, ...args], {
    cwd: opts.cwd ?? dirname(dirname(wrapper)),
    env: { ...process.env, ...(opts.env || {}) },
    encoding: "utf8",
    timeout: opts.timeout ?? 60_000,
  });
}

// --- GREEN path: repo-external cwd resolves correct cwd/package/major ---

for (const [ws, major, pkg] of [
  ["root", "20", "sangfor-agentic-os"],
  ["engineer", "20", "sangfor-engineer-mcp"],
  ["workflow", "22", "sangfor-mcp-workflow"],
]) {
  test(`repo-external cwd: ${ws} resolves cwd/package/major`, () => {
    assert.ok(existsSync(WRAPPER), "wrapper must exist for this fixture (GREEN path)");
    const outside = makeTemp();
    const r = runWrapper(
      [
        ws,
        "--",
        "node",
        "-e",
        `const p=require("./package.json");const m=process.versions.node.split(".")[0];if(p.name!==${JSON.stringify(pkg)}||m!==${JSON.stringify(major)})process.exit(2);process.stdout.write(JSON.stringify({cwd:process.cwd(),name:p.name,major:m}))`,
      ],
      { cwd: outside },
    );
    assert.equal(r.status, 0, r.stderr || r.stdout);
    const body = JSON.parse(r.stdout.trim().split("\n").pop());
    assert.equal(body.name, pkg);
    assert.equal(body.major, major);
  });
}

// --- exit 64 fixtures ---

test("unknown workspace -> exit 64", () => {
  const r = runWrapper(["nope", "--", "true"]);
  assert.equal(r.status, 64);
});

test("missing -- -> exit 64", () => {
  const r = runWrapper(["root", "true"]);
  assert.equal(r.status, 64);
});

test("empty command -> exit 64", () => {
  const r = runWrapper(["root", "--"]);
  assert.equal(r.status, 64);
});

test("wrong .nvmrc (fake repo) -> exit 64", () => {
  const { wrapper } = makeFakeRepo({ rootNvm: "18" });
  const r = runFake(wrapper, ["root", "--", "true"]);
  assert.equal(r.status, 64, r.stderr);
});

test("wrong package name (fake repo) -> exit 64", () => {
  const { wrapper } = makeFakeRepo({ rootName: "wrong-name" });
  const r = runFake(wrapper, ["root", "--", "true"]);
  assert.equal(r.status, 64, r.stderr);
});

// --- NVM zero candidates -> 69 ---

test("NVM zero candidates -> exit 69", () => {
  const empty = makeTemp();
  const r = runWrapper(["root", "--", "true"], {
    env: {
      HOME: empty,
      NVM_DIR: join(empty, "nvm-missing"),
      XDG_CONFIG_HOME: join(empty, "xdg"),
      PATH: process.env.PATH,
    },
  });
  // Override NVM_DIR to empty tree — wrapper still checks HOME/.nvm etc under empty
  assert.equal(r.status, 69, r.stderr);
});

test("setup-node runtime works without an nvm installation", () => {
  const empty = makeTemp();
  const r = runWrapper(["root", "--", "node", "-e", "process.stdout.write(process.versions.node)"], {
    env: {
      HOME: empty,
      NVM_DIR: join(empty, "nvm-missing"),
      XDG_CONFIG_HOME: join(empty, "xdg"),
      RUNNER_TOOL_CACHE: join(empty, "hostedtoolcache"),
      PATH: process.env.PATH,
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /using setup-node major=20/);
  assert.match(r.stdout, /^20\./);
});

// --- child exit 37 propagates ---

test("fake child exit 37 propagates as 37", () => {
  const r = runWrapper(["root", "--", "node", "-e", "process.exit(37)"]);
  assert.equal(r.status, 37);
});

// --- SIGTERM propagates ---

test("SIGTERM to child propagates as termination status", async () => {
  const child = spawn(
    "bash",
    [WRAPPER, "root", "--", "node", "-e", "setInterval(()=>{}, 1000)"],
    { cwd: REPO, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (child.pid) CHILD_PIDS.push(child.pid);
  // Wait until node is up
  await new Promise((r) => setTimeout(r, 800));
  child.kill("SIGTERM");
  const code = await new Promise((resolve) => {
    child.on("close", (c, signal) => {
      // Node typically exits 143 (128+15) on SIGTERM when not handled; bash exec may surface null+SIGTERM
      if (c !== null) resolve(c);
      else if (signal === "SIGTERM") resolve(128 + 15);
      else resolve(c);
    });
  });
  // Accept 143 (128+SIGTERM) or null-equivalent we mapped, or signal-based 143
  assert.ok(
    code === 143 || code === 128 + 15 || code === null,
    `unexpected termination status: ${code}`,
  );
  // Tighten: must NOT be 0
  assert.notEqual(code, 0);
});

// --- env sentinel byte-for-byte ---

test("env sentinel passes byte-for-byte", () => {
  const sentinel = "u003-sentinel-\u0001-bytes-✓";
  const r = runWrapper(["root", "--", "node", "-e", "process.stdout.write(process.env.TASK_RUN_ID||'')"], {
    env: {
      TASK_RUN_ID: sentinel,
      TASK_OWNER_UNIT: "U003",
      RESOURCE_LEASE_FILE: "/tmp/lease-u003",
      ACCEPTANCE_EVIDENCE_DIR: "/tmp/ev-u003",
    },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, sentinel);
});

// --- .env not read ---

test(".env sentinel in cwd is NOT read", () => {
  const outside = makeTemp();
  writeFileSync(join(outside, ".env"), "U003_ENV_LEAK=should-not-appear\n");
  const r = runWrapper(
    ["root", "--", "node", "-e", "process.stdout.write(process.env.U003_ENV_LEAK||'ABSENT')"],
    { cwd: outside },
  );
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, "ABSENT");
});

// --- symlink dedupe + priority ---

test("symlink dedupe: two raw candidates same canonical count once; distinct pick higher priority", () => {
  const tree = makeTemp();
  // Stub nvm A (higher priority via NVM_DIR)
  const nvmA = join(tree, "nvmA");
  mkdirSync(nvmA, { recursive: true });
  const nvmASh = join(nvmA, "nvm.sh");
  writeFileSync(
    nvmASh,
    `#!/bin/sh
echo "SELECTED_A" >> "${join(tree, "selected.log")}"
nvm() {
  case "$1" in
    version) echo "v20.20.2";;
    use) export PATH="${process.execPath.replace(/\/node$/, "")}:$PATH";;
    *) ;;
  esac
}
`,
  );
  // Stub nvm B (lower priority via HOME/.nvm) — distinct file
  const home = join(tree, "home");
  mkdirSync(join(home, ".nvm"), { recursive: true });
  const nvmBSh = join(home, ".nvm", "nvm.sh");
  writeFileSync(
    nvmBSh,
    `#!/bin/sh
echo "SELECTED_B" >> "${join(tree, "selected.log")}"
nvm() {
  case "$1" in
    version) echo "v20.20.2";;
    use) ;;
    *) ;;
  esac
}
`,
  );

  // Also create a symlink candidate that resolves to nvmA (dedupe)
  const xdg = join(tree, "xdg");
  mkdirSync(join(xdg, "nvm"), { recursive: true });
  symlinkSync(nvmASh, join(xdg, "nvm", "nvm.sh"));

  // Real repo workspaces — use real wrapper against real repo but fake NVM paths.
  // The wrapper still needs real nvm that can run node; stubs above are incomplete for full nvm use.
  // So we unit-test selection by invoking a dry discovery helper embedded via env and a mini probe:
  // Instead: copy wrapper into fake repo that has valid package map and use stubs that provide nvm + use system node via PATH.

  const { wrapper, base } = makeFakeRepo();
  // Improve stubs: nvm use must leave `node` on PATH as current node
  const nodeDir = dirname(process.execPath);
  writeFileSync(
    nvmASh,
    `nvm() {
  case "$1" in
    version) echo "v20.20.2"; return 0;;
    use) export PATH="${nodeDir}:$PATH"; return 0;;
    *) return 0;;
  esac
}
`,
  );
  writeFileSync(
    nvmBSh,
    `nvm() {
  case "$1" in
    version) echo "v20.20.2"; return 0;;
    use) export PATH="${nodeDir}:$PATH"; echo B_USED >> "${join(tree, "selected.log")}"; return 0;;
    *) return 0;;
  esac
}
`,
  );
  // Log which file was sourced by appending at top-level of nvm.sh
  writeFileSync(
    nvmASh,
    `echo A_SOURCED >> "${join(tree, "selected.log")}"
nvm() {
  case "$1" in
    version) echo "v20.20.2"; return 0;;
    use) export PATH="${nodeDir}:$PATH"; return 0;;
    *) return 0;;
  esac
}
`,
  );
  writeFileSync(
    nvmBSh,
    `echo B_SOURCED >> "${join(tree, "selected.log")}"
nvm() {
  case "$1" in
    version) echo "v20.20.2"; return 0;;
    use) export PATH="${nodeDir}:$PATH"; return 0;;
    *) return 0;;
  esac
}
`,
  );

  // Case 1: NVM_DIR + XDG symlink to same A → select A once (only A_SOURCED)
  rmSync(join(tree, "selected.log"), { force: true });
  const r1 = runFake(wrapper, ["root", "--", "node", "-e", "process.exit(0)"], {
    cwd: base,
    env: {
      HOME: home,
      NVM_DIR: nvmA,
      XDG_CONFIG_HOME: xdg,
      PATH: process.env.PATH,
    },
  });
  assert.equal(r1.status, 0, r1.stderr);
  const log1 = readFileSync(join(tree, "selected.log"), "utf8");
  const aCount = (log1.match(/A_SOURCED/g) || []).length;
  const bCount = (log1.match(/B_SOURCED/g) || []).length;
  assert.equal(aCount, 1, `expected single A source, got log: ${log1}`);
  assert.equal(bCount, 0, `B should not be sourced when A wins: ${log1}`);
  assert.match(r1.stderr, /selected nvm\.sh=/);

  // Case 2: distinct canonical — NVM_DIR points B higher? Priority: NVM_DIR > XDG > HOME
  // Put B in NVM_DIR and A in HOME → B wins
  rmSync(join(tree, "selected.log"), { force: true });
  const r2 = runFake(wrapper, ["root", "--", "node", "-e", "process.exit(0)"], {
    cwd: base,
    env: {
      HOME: join(tree, "homeA"),
      NVM_DIR: join(tree, "home", ".nvm"), // B is here as nvm.sh
      XDG_CONFIG_HOME: join(tree, "empty-xdg"),
      PATH: process.env.PATH,
    },
  });
  // Setup homeA/.nvm -> A for lower priority
  mkdirSync(join(tree, "homeA", ".nvm"), { recursive: true });
  writeFileSync(
    join(tree, "homeA", ".nvm", "nvm.sh"),
    `echo A_SOURCED >> "${join(tree, "selected.log")}"
nvm() {
  case "$1" in
    version) echo "v20.20.2"; return 0;;
    use) export PATH="${nodeDir}:$PATH"; return 0;;
    *) return 0;;
  esac
}
`,
  );
  const r2b = runFake(wrapper, ["root", "--", "node", "-e", "process.exit(0)"], {
    cwd: base,
    env: {
      HOME: join(tree, "homeA"),
      NVM_DIR: join(tree, "home", ".nvm"),
      XDG_CONFIG_HOME: join(tree, "empty-xdg"),
      PATH: process.env.PATH,
    },
  });
  assert.equal(r2b.status, 0, r2b.stderr);
  const log2 = readFileSync(join(tree, "selected.log"), "utf8");
  assert.match(log2, /B_SOURCED/, `higher priority B should win: ${log2}`);
  assert.doesNotMatch(log2, /A_SOURCED/, `A should be ignored: ${log2}`);
});
