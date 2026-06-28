#!/usr/bin/env node
/**
 * Integration stack process manager — spawns detached upstream services.
 */

import { spawn, execSync } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  openSync,
  unlinkSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STATE_DIR = join(ROOT, ".aios/runtime/integration-stack");
mkdirSync(STATE_DIR, { recursive: true });

const PLAYGROUND = process.env.AIOS_PLAYGROUND || join(ROOT, "..");

const SERVICES = [
  {
    name: "mail",
    cwd: process.env.MAIL_INTELLIGENCE_PATH || join(PLAYGROUND, "mail-intelligence"),
    cmd: process.execPath,
    args: ["server.mjs"],
    env: { PORT: "3010" },
    health: "http://127.0.0.1:3010/api/outlook/status",
  },
  {
    name: "aios-v1",
    cwd: process.env.AIOS_V1_PATH || join(PLAYGROUND, "AIOS v1"),
    cmd: "pnpm",
    args: ["dev"],
    health: "http://127.0.0.1:3101/api/health",
  },
  {
    name: "f-aios-v3",
    cwd: process.env.F_AIOS_V3_PATH || join(PLAYGROUND, "F - aios-v3-core/server"),
    cmd: "pnpm",
    args: ["dev"],
    env: { PORT: "3201" },
    health: "http://127.0.0.1:3201/api/health",
  },
  {
    name: "sangfor",
    cwd: process.env.SANGFOR_PATH || join(ROOT, "services/sangfor-mcp-workflow"),
    cmd: "pnpm",
    args: ["dev:web"],
    env: { SANGFOR_API_KEY: process.env.SANGFOR_API_KEY || "integration-dev-key" },
    health: "http://127.0.0.1:3500/api/system/health",
  },
  {
    name: "vibe",
    cwd: process.env.VIBE_PATH || join(PLAYGROUND, "vibe-coding-os"),
    cmd: "pnpm",
    args: ["dev"],
    env: { FEATURE_RBAC: "0" },
    health: "http://127.0.0.1:4000/api/health",
    preStart: "vibe",
  },
  {
    name: "whelp99-bridge",
    cwd: process.env.WHELP99_PATH || join(ROOT, "services/sangfor-engineer-mcp"),
    cmd: "pnpm",
    args: ["dev:http-bridge"],
    env: { PORT: "3600" },
    health: "http://127.0.0.1:3600/health",
  },
  {
    name: "portal",
    cwd: ROOT,
    cmd: "pnpm",
    args: ["--filter", "@aios/web", "dev"],
    health: "http://127.0.0.1:3110/api/integrations/health",
  },
];

function pidPath(name) {
  return join(STATE_DIR, `${name}.pid`);
}

function logPath(name) {
  return join(STATE_DIR, `${name}.log`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function freePort(port) {
  try {
    const out = execSync(`lsof -ti :${port}`, { encoding: "utf8" }).trim();
    if (!out) return;
    for (const pid of out.split("\n")) {
      const n = Number(pid);
      if (n && n !== process.pid) {
        try {
          process.kill(n, "SIGTERM");
          console.log(`[stack] freed port ${port} pid ${n}`);
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // port already free
  }
}

function startDockerDeps() {
  const pairs = [
    { cwd: process.env.AIOS_V1_PATH || join(PLAYGROUND, "AIOS v1"), services: "redis postgres" },
    { cwd: process.env.VIBE_PATH || join(PLAYGROUND, "vibe-coding-os"), services: "db" },
  ];
  for (const { cwd, services } of pairs) {
    try {
      execSync(`docker compose -f "${join(cwd, "docker-compose.yml")}" up -d ${services}`, {
        stdio: "pipe",
        timeout: 120_000,
      });
      console.log(`[stack] docker deps started in ${cwd} (${services})`);
    } catch (error) {
      console.log(
        `[stack] docker deps skipped for ${cwd}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function freeIntegrationPorts() {
  for (const port of [3010, 3101, 3201, 3500, 3502, 4000, 3600, 3110]) {
    freePort(port);
  }
}

function preStartHook(service) {
  if (service.preStart === "vibe") {
    freePort(4000);
    freePort(4100); // CFO-AI legacy default
  }
}

function startOne(service) {
  preStartHook(service);
  const pidFile = pidPath(service.name);
  if (existsSync(pidFile)) {
    const old = Number(readFileSync(pidFile, "utf8"));
    if (isAlive(old)) {
      console.log(`[stack] ${service.name} already running pid ${old}`);
      return;
    }
  }

  const outFd = openSync(logPath(service.name), "a");
  const child = spawn(service.cmd, service.args, {
    cwd: service.cwd,
    env: { ...process.env, ...service.env },
    detached: true,
    stdio: ["ignore", outFd, outFd],
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  console.log(`[stack] started ${service.name} pid ${child.pid}`);
}

function stopOne(service) {
  const pidFile = pidPath(service.name);
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, "utf8"));
  if (isAlive(pid)) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
    console.log(`[stack] stopped ${service.name} pid ${pid}`);
  }
  try {
    unlinkSync(pidFile);
  } catch {
    // ignore
  }
}

async function waitUrl(url, retries = 45) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 503) {
        console.log(`[stack] ready ${url} (${res.status})`);
        return true;
      }
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  console.log(`[stack] timeout ${url}`);
  return false;
}

const action = process.argv[2] ?? "start";

if (action === "start") {
  startDockerDeps();
  freeIntegrationPorts();
  for (const s of SERVICES) startOne(s);
} else if (action === "stop") {
  for (const s of [...SERVICES].reverse()) stopOne(s);
} else if (action === "status") {
  for (const s of SERVICES) {
    const pidFile = pidPath(s.name);
    const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : null;
    console.log(
      `[stack] ${s.name}: ${pid && isAlive(pid) ? `running pid ${pid}` : "stopped"}`,
    );
  }
} else if (action === "wait-health") {
  let ok = true;
  for (const s of SERVICES) {
    if (!(await waitUrl(s.health))) ok = false;
  }
  process.exit(ok ? 0 : 1);
} else {
  console.log(
    "Usage: node scripts/start-integration-stack.mjs {start|stop|status|wait-health}",
  );
  process.exit(1);
}
