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
 * Prints the paths and ports the campaign needs.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(import.meta.dirname, "..");

/**
 * The path layout, kept pure so it can be checked without a filesystem or a
 * particular working-tree state.
 *
 * perf-smoke.mjs pins the layout, not just the paths: it recomputes the attempt
 * root from the lease file and requires the alias evidence directory to sit at
 * `<attemptRoot>/aliases/T-PERF` beside a `<attemptRoot>/leases/` directory.
 * Every alias uses that shape, so the T-PERF rule holds by construction rather
 * than through a special case that later drifts. Getting it wrong fails the
 * campaign 22 aliases in, about an hour from the start.
 */
export function buildLeaseMap({ aliases, runRoot, runId, aliasPorts }) {
  const leasesDir = join(runRoot, "leases");
  const aliasesDir = join(runRoot, "aliases");
  const leaseMap = {};
  aliases.forEach((entry, index) => {
    leaseMap[entry.alias] = {
      runId: `${runId}-${entry.alias.toLowerCase()}`,
      ownerUnit: entry.executionOwnerUnit,
      webPort: aliasPorts[index * 2],
      apiPort: aliasPorts[index * 2 + 1],
      leaseFile: join(leasesDir, `${entry.alias}.json`),
      evidenceDir: join(aliasesDir, entry.alias),
    };
  });
  return { leaseMap, leasesDir, aliasesDir };
}

/** Binds an ephemeral port and reports it, then releases it. */
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

async function main() {
  const hours = Number.parseInt(process.argv[process.argv.indexOf("--hours") + 1] ?? "8", 10) || 8;
  const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: ROOT, encoding: "utf8" });
  if (status !== "") {
    process.stderr.write("refusing to provision: the campaign requires a clean tree for its whole duration\n");
    process.exit(64);
  }

  const aliases = JSON.parse(readFileSync(join(ROOT, "docs/12_VERIFICATION/test-alias-map.json"), "utf8"));
  const stamp = new Date().toISOString().replace(/[:-]/g, "").replace(/\.\d+Z$/, "Z");
  const runRoot = join(realpathSync(join(homedir(), ".local/share")), `sangfor-u076-${candidateSha.slice(0, 8)}-${stamp}`);
  const attemptDir = join(runRoot, "attempt");
  mkdirSync(attemptDir, { recursive: true, mode: 0o700 });

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + hours * 3600_000);
  const runId = `u076-main-${issuedAt.getTime()}`;
  const [webPort, apiPort, ...aliasPorts] = await distinctPorts(2 + aliases.length * 2);

  const scmHandoffFile = join(runRoot, "scm-handoff.json");
  writeFileSync(
    scmHandoffFile,
    `${JSON.stringify(
      { candidateSha, committedBy: "SCM", issuedAt: issuedAt.toISOString(), sourceHead: candidateSha, sourceStatus: "clean" },
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

  const { leaseMap, leasesDir, aliasesDir } = buildLeaseMap({ aliases, runRoot, runId, aliasPorts });
  mkdirSync(leasesDir, { recursive: true, mode: 0o700 });
  mkdirSync(aliasesDir, { recursive: true, mode: 0o700 });
  for (const lease of Object.values(leaseMap)) {
    mkdirSync(lease.evidenceDir, { recursive: true, mode: 0o700 });
    const { leaseFile, evidenceDir: _unused, ...receipt } = lease;
    writeFileSync(
      leaseFile,
      `${JSON.stringify({ ...receipt, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt.toISOString() }, null, 2)}\n`,
      { mode: 0o600 },
    );
  }

  const leaseMapFile = join(runRoot, "alias-lease-map.json");
  writeFileSync(leaseMapFile, `${JSON.stringify(leaseMap, null, 2)}\n`, { mode: 0o600 });

  process.stdout.write(
    `${JSON.stringify(
      {
        candidateSha,
        runId,
        runRoot,
        attemptDir,
        scmHandoffFile,
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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(70);
  });
}
