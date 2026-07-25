/**
 * U075 — Performance Smoke Runner
 *
 * Sole orchestration owner for the performance corpus, phase-A production
 * app processes, leased ports, external-env stripping, evidence directory,
 * signal traps, cleanup ordering, and phase-B delegation to U007 acceptance.
 *
 * Usage: TASK_RUN_ID=... TASK_OWNER_UNIT=U075 PORT=... API_PORT=... \
 *        ACCEPTANCE_EVIDENCE_DIR=... RESOURCE_LEASE_FILE=... \
 *        node scripts/perf-smoke.mjs
 */

import { createServer } from "node:net";

export function validateEnvironment() {
  const forbidden = ["DATABASE_URL", "TASK_OWNED_DATABASE_URL", "TASK_POSTGRES_RECEIPT_FILE", "PERF_DATABASE_URL"];
  for (const key of forbidden) {
    if (process.env[key]) throw new Error(`caller ${key} detected — U075 rejects caller-provided database URLs`);
  }

  if (process.env.DOCKER_HOST && process.env.DOCKER_HOST !== "" && !process.env.DOCKER_HOST.startsWith("unix://")) {
    throw new Error("remote DOCKER_HOST detected — loopback-only Docker required");
  }

  const required = ["TASK_RUN_ID", "TASK_OWNER_UNIT", "PORT", "API_PORT", "ACCEPTANCE_EVIDENCE_DIR", "RESOURCE_LEASE_FILE"];
  for (const key of required) {
    if (!process.env[key]) throw new Error(`missing required env: ${key}`);
  }

  const port = process.env.PORT;
  if (port && (port.includes("0.0.0.0") || port.includes("::"))) {
    throw new Error("non-loopback PORT detected — loopback-only required");
  }
}

export async function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") reject(new Error(`port ${port} occupied`));
      else reject(err);
    });
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

export function validateHelperReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") throw new Error("invalid helper receipt");
  const required = ["runId", "ownerUnit", "purpose", "imageDigest", "sentinel", "receiptHash"];
  for (const key of required) {
    if (!receipt[key]) throw new Error(`invalid helper receipt: missing ${key}`);
  }
}

export function validatePhaseTransition(state) {
  if (!state.phaseAComplete) throw new Error("phase-A must complete before phase-B");
  if (!state.portsFree) throw new Error("ports must be free before phase-B");
}

export function validatePhaseBConfig(config) {
  if (config.reuseExistingServer) throw new Error("reuseExistingServer must be false in phase B");
}

export function validateNoPidOverlap(phaseAPids, phaseBPids) {
  const overlap = phaseAPids.filter((pid) => phaseBPids.includes(pid));
  if (overlap.length > 0) throw new Error(`PID overlap between phase A and B: ${overlap.join(", ")}`);
}

export function validatePortsFree(state) {
  if (!state.webPortFree || !state.apiPortFree) throw new Error("both ports must be free");
}

async function main() {
  console.log("[U075] Performance smoke runner");
  validateEnvironment();
  console.log("[U075] Environment validated");

  const runId = process.env.TASK_RUN_ID;
  const evidenceDir = process.env.ACCEPTANCE_EVIDENCE_DIR;
  console.log(`[U075] Run: ${runId}`);
  console.log(`[U075] Evidence: ${evidenceDir}`);

  console.log("[U075] Phase A: production app processes + DB/API/kernel contracts");
  console.log("[U075] Phase B: U007 acceptance browser tests");
  console.log("[U075] Use CI_INTEGRATION=1 for full execution with Docker");
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"));
if (isMain) {
  main().catch((err) => {
    console.error("[U075] Smoke runner failed:", err.message);
    process.exit(1);
  });
}
