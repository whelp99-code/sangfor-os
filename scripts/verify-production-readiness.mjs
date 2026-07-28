import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA64 = /^[a-f0-9]{64}$/u;

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function validateProductionReadiness({ candidateSha, finalAcceptance, finalAcceptanceSha256, externalReceipt, externalReceiptPath }) {
  const issues = [];
  if (!SHA40.test(candidateSha ?? "")) issues.push("candidateSha must be lowercase 40-hex");
  if (finalAcceptance?.schemaVersion !== 1 || finalAcceptance?.candidateSha !== candidateSha) issues.push("final acceptance candidate identity mismatch");
  if (finalAcceptance?.authority !== "AUTHORITATIVE_MIRROR_INTERNAL" || !SHA64.test(finalAcceptance?.contextHash ?? "") || !SHA64.test(finalAcceptance?.aliasMapHash ?? "")) issues.push("final acceptance authority or provenance invalid");
  if (finalAcceptance?.state !== "LOCAL_PASS_EXTERNAL_PENDING" || finalAcceptance?.autonomousPassed !== 98 || finalAcceptance?.manualPending !== 1 || finalAcceptance?.cleanup !== "PASS") {
    issues.push("final acceptance must prove 98 local passes, one external pending row, and cleanup PASS");
  }
  if (!finalAcceptance?.runId || Number.isNaN(Date.parse(finalAcceptance?.createdAt))) issues.push("final acceptance run identity invalid");

  if (externalReceipt?.schemaVersion !== 1 || externalReceipt?.candidateSha !== candidateSha || externalReceipt?.manifestId !== "AC-DOD-09" || externalReceipt?.runId !== finalAcceptance?.runId || externalReceipt?.ownerUnit !== "U076") issues.push("external receipt candidate or run identity mismatch");
  if (!SHA64.test(finalAcceptanceSha256 ?? "") || externalReceipt?.localAcceptanceSha256 !== finalAcceptanceSha256) issues.push("external receipt is not bound to the exact local acceptance evidence");
  if (externalReceipt?.verificationState !== "MANUAL_EXTERNAL_PASS" || externalReceipt?.executed !== true || externalReceipt?.result !== "PASS") issues.push("AC-DOD-09 must be executed with MANUAL_EXTERNAL_PASS");
  if (!externalReceipt?.approval?.id || !externalReceipt?.approval?.approvedBy || Number.isNaN(Date.parse(externalReceipt?.approval?.approvedAt))) issues.push("external receipt requires explicit human approval identity and timestamp");
  if (externalReceipt?.approvalRequired !== true || Number.isNaN(Date.parse(externalReceipt?.issuedAt)) || Date.parse(externalReceipt?.approval?.approvedAt) < Date.parse(finalAcceptance?.createdAt) || Date.parse(externalReceipt?.issuedAt) < Date.parse(externalReceipt?.approval?.approvedAt)) issues.push("external approval chronology invalid");
  if (!Array.isArray(externalReceipt?.commands) || externalReceipt.commands.length === 0 || !externalReceipt.commands.every((command) => Array.isArray(command.argv) && command.argv.length > 0 && command.exitCode === 0 && Number.isInteger(command.testCount) && command.testCount > 0)) issues.push("external receipt commands must prove nonzero successful tests");

  const receiptDirectory = dirname(externalReceiptPath);
  if (!Array.isArray(externalReceipt?.artifactHashes) || externalReceipt.artifactHashes.length === 0) {
    issues.push("external receipt requires artifact hashes");
  } else {
    for (const artifact of externalReceipt.artifactHashes) {
      if (typeof artifact?.path !== "string" || isAbsolute(artifact.path) || artifact.path.split(/[\\/]/u).includes("..") || !SHA64.test(artifact.sha256 ?? "") || !Number.isInteger(artifact.bytes) || artifact.bytes < 1) {
        issues.push("external receipt artifact metadata invalid");
        continue;
      }
      try {
        const artifactPath = resolve(receiptDirectory, artifact.path);
        const bytes = readFileSync(artifactPath);
        if (bytes.length !== artifact.bytes || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) issues.push(`external artifact mismatch: ${artifact.path}`);
      } catch {
        issues.push(`external artifact missing: ${artifact.path}`);
      }
    }
  }
  if (issues.length > 0) throw new Error(`production readiness rejected:\n${issues.join("\n")}`);
  return { ok: true, candidateSha, localState: finalAcceptance.state, externalState: externalReceipt.verificationState };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) throw new Error("usage: verify-production-readiness --candidate-sha SHA --final-acceptance FILE --external-receipt FILE");
    values[key.slice(2)] = value;
  }
  return values;
}

export function verifyProductionReadiness({ candidateSha, finalAcceptancePath, externalReceiptPath }) {
  const finalPath = resolve(finalAcceptancePath);
  const externalPath = resolve(externalReceiptPath);
  if (!statSync(finalPath).isFile() || !statSync(externalPath).isFile()) throw new Error("acceptance evidence paths must be files");
  const finalBytes = readFileSync(finalPath);
  return validateProductionReadiness({ candidateSha, finalAcceptance: JSON.parse(finalBytes), finalAcceptanceSha256: createHash("sha256").update(finalBytes).digest("hex"), externalReceipt: readJson(externalPath), externalReceiptPath: externalPath });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = verifyProductionReadiness({ candidateSha: args["candidate-sha"], finalAcceptancePath: args["final-acceptance"], externalReceiptPath: args["external-receipt"] });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 64;
  }
}
