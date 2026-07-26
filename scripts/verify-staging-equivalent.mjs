import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHA40 = /^[a-f0-9]{40}$/;

export class StagingVerificationError extends Error {}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function verifyStagingEquivalentSet({ candidateSha, runId, phaseA, phaseB }) {
  if (!SHA40.test(candidateSha ?? "") || typeof runId !== "string" || runId.length === 0) {
    throw new StagingVerificationError("candidate SHA and runId are required");
  }
  for (const [label, phase] of [["phase A", phaseA], ["phase B", phaseB]]) {
    if (
      !phase ||
      phase.candidateSha !== candidateSha ||
      phase.runId !== runId ||
      phase.ownerUnit !== "U076"
    ) {
      throw new StagingVerificationError(`${label} candidate SHA/run identity mismatch`);
    }
    if (
      !Number.isInteger(phase.webPort) ||
      !Number.isInteger(phase.apiPort) ||
      phase.webPort === phase.apiPort
    ) {
      throw new StagingVerificationError(`${label} ports invalid`);
    }
  }
  if (
    phaseA.webPort !== phaseB.webPort ||
    phaseA.apiPort !== phaseB.apiPort ||
    phaseA.health?.web !== 200 ||
    phaseA.health?.api !== 200
  ) {
    throw new StagingVerificationError("phase A health or port identity mismatch");
  }
  if (
    phaseA.cleanup?.result !== "PASS" ||
    phaseA.cleanup.processes !== 0 ||
    phaseA.cleanup.portsFree !== true
  ) {
    throw new StagingVerificationError("phase A cleanup must release listeners before phase B");
  }
  const playwright = phaseB.playwright;
  if (
    !playwright ||
    playwright.exitCode !== 0 ||
    !Number.isInteger(playwright.totalTests) ||
    playwright.totalTests <= 0 ||
    playwright.skipped !== 0 ||
    playwright.retries !== 0 ||
    playwright.workers !== 1 ||
    playwright.reuseExistingServer !== false
  ) {
    throw new StagingVerificationError("phase B must use one fresh server with strict Playwright PASS");
  }
  const surface = phaseB.surface;
  if (!surface || !same(surface.widths, [375, 768, 1280])) {
    throw new StagingVerificationError("release surface widths must be exactly 375/768/1280");
  }
  if (
    surface.axeViolations !== 0 ||
    surface.keyboardFailures !== 0 ||
    surface.consoleErrors !== 0 ||
    surface.networkErrors !== 0
  ) {
    throw new StagingVerificationError("release surface must have zero axe/keyboard/console/network failures");
  }
  if (
    phaseB.cleanup?.result !== "PASS" ||
    phaseB.cleanup.processes !== 0 ||
    phaseB.cleanup.portsFree !== true ||
    phaseB.cleanup.databases !== 0
  ) {
    throw new StagingVerificationError("phase B cleanup must remove all processes, ports, and databases");
  }
  return Object.freeze({ candidateSha, runId, result: "PASS" });
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value) {
      throw new StagingVerificationError(
        "usage: verify-staging-equivalent --candidate-sha SHA --run-id ID --phase-a FILE --phase-b FILE [--output FILE]",
      );
    }
    values[flag.slice(2)] = value;
  }
  return values;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = verifyStagingEquivalentSet({
    candidateSha: args["candidate-sha"],
    runId: args["run-id"],
    phaseA: JSON.parse(await readFile(path.resolve(args["phase-a"]), "utf8")),
    phaseB: JSON.parse(await readFile(path.resolve(args["phase-b"]), "utf8")),
  });
  const output = {
    schemaVersion: 1,
    authority: process.env.U076_AUTHORITATIVE === "1" ? "AUTHORITATIVE" : "DIAGNOSTIC_ONLY",
    ...result,
    verifiedAt: new Date().toISOString(),
  };
  if (args.output) await writeFile(path.resolve(args.output), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof StagingVerificationError ? 64 : 70;
  });
}
