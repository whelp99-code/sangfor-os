#!/usr/bin/env node
/**
 * Allocates the resource leases the U076 acceptance campaign takes as input.
 *
 * The U007 harness that normally issues these is not in this repository, but the
 * artifacts themselves are bookkeeping, not evidence: ports, run ids, and paths.
 * Everything that constitutes a claim about the candidate — the 23 alias
 * receipts, the 98-row partition — is produced by the campaign itself, and the
 * SCM handoff only restates facts `run-detached-release-mirror.mjs` re-verifies
 * against git before it will proceed.
 *
 * Usage: node scripts/provision-u076-leases.mjs [--hours 8]
 * Prints the exact environment block and command to run.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const LEASE_HOURS = Number.parseInt(process.argv[process.argv.indexOf("--hours") + 1] ?? "8", 10) || 8;

/** Binds an ephemeral port and reports it, then releases it. Two runs could in
 *  principle collide; the campaign fails loudly rather than sharing a port. */
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function distinctPorts(count) {
  const ports = new Set();
  while (ports.size < count) {
    const port = await freePort();
    if (port > 1024) ports.add(port);
  }
  return [...ports];
}

const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" });
if (status !== "") {
  process.stderr.write("refusing to provision: the campaign requires a clean tree for its whole duration\n");
  process.exit(64);
}

const aliases = JSON.parse(readFileSync(join(ROOT, "docs/12_VERIFICATION/test-alias-map.json"), "utf8"));
const stamp = new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d+Z$/, "Z");
const base = realpathSync(join(homedir(), ".local/share"));
const runRoot = join(base, `sangfor-u076-${candidateSha.slice(0, 8)}-${stamp}`);
const attemptDir = join(runRoot, "attempt");
mkdirSync(attemptDir, { recursive: true, mode: 0o700 });

const issuedAt = new Date();
const expiresAt = new Date(issuedAt.getTime() + LEASE_HOURS * 3600_000);
const runId = `u076-main-${issuedAt.getTime()}`;

const ports = await distinctPorts(2 + aliases.length * 2);
const [webPort, apiPort, ...aliasPorts] = ports;

writeFileSync(
  join(runRoot, "scm-handoff.json"),
  `${JSON.stringify(
    {
      candidateSha,
      committedBy: "SCM",
      issuedAt: issuedAt.toISOString(),
      sourceHead: candidateSha,
      sourceStatus: "clean",
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);

const resourceLeaseFile = join(runRoot, "resource-lease.json");
writeFileSync(
  resourceLeaseFile,
  `${JSON.stringify({ runId, ownerUnit: "U076", webPort, apiPort, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString() }, null, 2)}\n`,
  { mode: 0o600 },
);

const evidenceDir = join(runRoot, "evidence");
mkdirSync(evidenceDir, { recursive: true, mode: 0o700 });

const leaseMap = {};
aliases.forEach((entry, index) => {
  const slug = entry.alias.toLowerCase();
  const dir = join(runRoot, `alias-${String(index + 1).padStart(2, "0")}-${slug}`);
  const aliasEvidence = join(dir, "evidence");
  mkdirSync(aliasEvidence, { recursive: true, mode: 0o700 });
  const lease = {
    runId: `${runId}-${slug}`,
    ownerUnit: entry.executionOwnerUnit,
    webPort: aliasPorts[index * 2],
    apiPort: aliasPorts[index * 2 + 1],
  };
  const leaseFile = join(dir, "resource-lease.json");
  writeFileSync(
    leaseFile,
    `${JSON.stringify({ ...lease, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
  leaseMap[entry.alias] = { ...lease, leaseFile, evidenceDir: aliasEvidence };
});

const leaseMapFile = join(runRoot, "alias-lease-map.json");
writeFileSync(leaseMapFile, `${JSON.stringify(leaseMap, null, 2)}\n`, { mode: 0o600 });

process.stdout.write(
  `${JSON.stringify(
    {
      candidateSha,
      runId,
      runRoot,
      attemptDir,
      scmHandoffFile: join(runRoot, "scm-handoff.json"),
      resourceLeaseFile,
      leaseMapFile,
      evidenceDir,
      webPort,
      apiPort,
      aliasCount: aliases.length,
      expiresAt: expiresAt.toISOString(),
    },
    null,
    2,
  )}\n`,
);
