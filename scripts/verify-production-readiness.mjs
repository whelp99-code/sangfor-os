import { createHash, sign as signDetached, verify as verifyDetached } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, loadProductionAuthority } from "./lib/production-authority.mjs";

const SHA40 = /^[a-f0-9]{40}$/u;
const SHA64 = /^[a-f0-9]{64}$/u;
const APPROVAL_DOMAIN = "sangfor.production-approval/v1";
const NONCE_AUTHORITY_RELEASE_GATE_FILE = "nonce-authority-release-gate.json";
const NONCE_AUTHORITY_RELEASE_LANES = ["nonce-lint", "nonce-typecheck", "nonce-unit", "nonce-build"];
const NONCE_AUTHORITY_RELEASE_GATE_KEYS = ["candidateSha", "runId", "schemaVersion", "steps", "workspace"];
const NONCE_AUTHORITY_RELEASE_STEP_KEYS = ["argv", "counts", "durationMs", "exitCode", "id", "outputHash", "reason", "verdict"];
const NONCE_AUTHORITY_COUNT_KEYS = ["failed", "fixme", "flaky", "noTestsPhrase", "only", "parseable", "passed", "retry", "skipped", "todo", "total"];
const FINAL_ACCEPTANCE_KEYS = ["autonomousPassed", "candidateSha", "cleanup", "createdAt", "detachedMirrorReceiptSha256", "innerSummarySha256", "manualPending", "nonceAuthorityReleaseGateSha256", "runId", "schemaVersion", "scmHandoffSha256", "state", "unit"];

function unsignedReceipt(receipt) {
  const { signature: _signature, ...unsigned } = receipt;
  return unsigned;
}

export function signProductionApprovalReceipt(receipt, key) {
  return signDetached(null, Buffer.from(`${APPROVAL_DOMAIN}\n${canonicalJson(unsignedReceipt(receipt))}`), key).toString("base64url");
}

function verifyApprovalSignature(receipt, keyring) {
  const signature = receipt?.signature;
  const entry = signature && keyring?.[signature.keyId];
  if (!signature || signature.algorithm !== "Ed25519" || !entry || entry.status !== "verify" || typeof entry.publicKeyPem !== "string") return false;
  const supplied = typeof signature.value === "string" && /^[A-Za-z0-9_-]+$/u.test(signature.value) ? Buffer.from(signature.value, "base64url") : Buffer.alloc(0);
  if (supplied.length !== 64) return false;
  try {
    return verifyDetached(null, Buffer.from(`${APPROVAL_DOMAIN}\n${canonicalJson(unsignedReceipt(receipt))}`), entry.publicKeyPem, supplied);
  } catch {
    return false;
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function exactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === keys.join("\0");
}

function validNonceAuthorityReleaseGate(gate, candidateSha, runId) {
  if (!exactKeys(gate, NONCE_AUTHORITY_RELEASE_GATE_KEYS) || gate.schemaVersion !== 1 || gate.candidateSha !== candidateSha || gate.runId !== runId || gate.workspace !== "services/production-nonce-authority" || !Array.isArray(gate.steps) || gate.steps.length !== NONCE_AUTHORITY_RELEASE_LANES.length) return false;
  return gate.steps.every((step, index) => {
    const expectedArgv = ["bash", "scripts/run-workspace-runtime.sh", "nonce", "--", "corepack", "pnpm", index === 2 ? "test" : NONCE_AUTHORITY_RELEASE_LANES[index].slice("nonce-".length)];
    if (!exactKeys(step, NONCE_AUTHORITY_RELEASE_STEP_KEYS) || step.id !== NONCE_AUTHORITY_RELEASE_LANES[index] || step.verdict !== "PASS" || step.exitCode !== 0 || !Number.isInteger(step.durationMs) || step.durationMs < 0 || !SHA64.test(step.outputHash ?? "") || JSON.stringify(step.argv) !== JSON.stringify(expectedArgv) || typeof step.reason !== "string" || step.reason.length === 0 || !exactKeys(step.counts, NONCE_AUTHORITY_COUNT_KEYS)) return false;
    const counts = step.counts;
    if (!["fixme", "flaky", "only", "retry", "skipped", "todo"].every((key) => Number.isInteger(counts[key]) && counts[key] === 0) || counts.noTestsPhrase !== false) return false;
    if (index === 2) return step.reason === "strict_test_pass" && counts.parseable === true && Number.isInteger(counts.total) && counts.total > 0 && counts.failed === 0 && Number.isInteger(counts.passed) && counts.passed > 0 && counts.passed === counts.total;
    return step.reason === "command_exit_0" && counts.parseable === false && counts.total === null && counts.passed === null && counts.failed === null;
  });
}

export function validateProductionReadiness({ candidateSha, finalAcceptance, finalAcceptanceSha256, nonceAuthorityReleaseGate, nonceAuthorityReleaseGateSha256, externalReceipt, externalReceiptPath, approvalIssuer, approvalKeyring }) {
  const issues = [];
  if (!SHA40.test(candidateSha ?? "")) issues.push("candidateSha must be lowercase 40-hex");
  if (!exactKeys(finalAcceptance, FINAL_ACCEPTANCE_KEYS) || finalAcceptance?.schemaVersion !== 1 || finalAcceptance?.unit !== "U076" || finalAcceptance?.candidateSha !== candidateSha) issues.push("final acceptance candidate identity or schema invalid");
  if (!["innerSummarySha256", "detachedMirrorReceiptSha256", "scmHandoffSha256"].every((key) => SHA64.test(finalAcceptance?.[key] ?? ""))) issues.push("final acceptance provenance hashes invalid");
  if (finalAcceptance?.state !== "LOCAL_PASS_EXTERNAL_PENDING" || finalAcceptance?.autonomousPassed !== 98 || finalAcceptance?.manualPending !== 1 || finalAcceptance?.cleanup !== "PASS") {
    issues.push("final acceptance must prove 98 local passes, one external pending row, and cleanup PASS");
  }
  if (!finalAcceptance?.runId || Number.isNaN(Date.parse(finalAcceptance?.createdAt))) issues.push("final acceptance run identity invalid");
  if (!SHA64.test(finalAcceptance?.nonceAuthorityReleaseGateSha256 ?? "") || finalAcceptance.nonceAuthorityReleaseGateSha256 !== nonceAuthorityReleaseGateSha256) issues.push("final acceptance nonce authority release-gate hash invalid");
  if (!validNonceAuthorityReleaseGate(nonceAuthorityReleaseGate, candidateSha, finalAcceptance?.runId)) issues.push("nonce authority release-gate evidence invalid");

  if (externalReceipt?.schemaVersion !== 1 || externalReceipt?.candidateSha !== candidateSha || externalReceipt?.manifestId !== "AC-DOD-09" || externalReceipt?.runId !== finalAcceptance?.runId || externalReceipt?.ownerUnit !== "U076") issues.push("external receipt candidate or run identity mismatch");
  if (!SHA64.test(finalAcceptanceSha256 ?? "") || externalReceipt?.localAcceptanceSha256 !== finalAcceptanceSha256) issues.push("external receipt is not bound to the exact local acceptance evidence");
  if (externalReceipt?.verificationState !== "MANUAL_EXTERNAL_PASS" || externalReceipt?.executed !== true || externalReceipt?.result !== "PASS") issues.push("AC-DOD-09 must be executed with MANUAL_EXTERNAL_PASS");
  if (!externalReceipt?.approval?.id || !externalReceipt?.approval?.approvedBy || Number.isNaN(Date.parse(externalReceipt?.approval?.approvedAt))) issues.push("external receipt requires explicit human approval identity and timestamp");
  if (externalReceipt?.approval?.issuer !== approvalIssuer || !/^[A-Za-z0-9._-]{32,128}$/u.test(externalReceipt?.approval?.nonce ?? "")) issues.push("external approval issuer or nonce invalid");
  if (!verifyApprovalSignature(externalReceipt, approvalKeyring)) issues.push("external approval signature invalid");
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
    const gateArtifacts = externalReceipt.artifactHashes.filter((artifact) => artifact?.path === NONCE_AUTHORITY_RELEASE_GATE_FILE);
    if (gateArtifacts.length !== 1 || gateArtifacts[0]?.sha256 !== nonceAuthorityReleaseGateSha256) issues.push("external receipt must bind the nonce authority release-gate artifact hash");
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

export async function consumeApprovalNonce(receipt, authority, fetchImpl = fetch) {
  const receiptSha256 = createHash("sha256").update(canonicalJson(receipt)).digest("hex");
  const request = { schemaVersion: 1, issuer: receipt.approval.issuer, nonce: receipt.approval.nonce, approvalId: receipt.approval.id, candidateSha: receipt.candidateSha, runId: receipt.runId, receiptSha256 };
  const response = await fetchImpl(authority.nonceConsumeUrl, {
    method: "POST",
    headers: { authorization: `Bearer ${authority.nonceConsumeBearerToken}`, "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  if (response.status !== 201) throw new Error(`external approval nonce consumption rejected with HTTP ${response.status}`);
  const result = await response.json();
  if (result?.schemaVersion !== 1 || result?.consumed !== true || result?.receiptSha256 !== receiptSha256 || result?.nonce !== receipt.approval.nonce) throw new Error("external approval nonce authority response invalid");
}

export async function verifyProductionReadinessWithAuthority({ candidateSha, finalAcceptancePath, externalReceiptPath, authorityPath, allowNonRootAuthorityForTests = false, fetchImpl = fetch }) {
  const finalPath = resolve(finalAcceptancePath);
  const externalPath = resolve(externalReceiptPath);
  if (!statSync(finalPath).isFile() || !statSync(externalPath).isFile()) throw new Error("acceptance evidence paths must be files");
  const finalBytes = readFileSync(finalPath);
  const nonceAuthorityReleaseGatePath = resolve(dirname(finalPath), NONCE_AUTHORITY_RELEASE_GATE_FILE);
  if (!existsSync(nonceAuthorityReleaseGatePath) || !statSync(nonceAuthorityReleaseGatePath).isFile()) throw new Error("nonce authority release-gate evidence path must be a file");
  const nonceAuthorityReleaseGateBytes = readFileSync(nonceAuthorityReleaseGatePath);
  const externalReceipt = readJson(externalPath);
  const { authority } = loadProductionAuthority(authorityPath, { allowNonRootOwner: allowNonRootAuthorityForTests });
  const result = validateProductionReadiness({ candidateSha, finalAcceptance: JSON.parse(finalBytes), finalAcceptanceSha256: createHash("sha256").update(finalBytes).digest("hex"), nonceAuthorityReleaseGate: JSON.parse(nonceAuthorityReleaseGateBytes), nonceAuthorityReleaseGateSha256: createHash("sha256").update(nonceAuthorityReleaseGateBytes).digest("hex"), externalReceipt, externalReceiptPath: externalPath, approvalIssuer: authority.approvalIssuer, approvalKeyring: authority.approvalKeys });
  await consumeApprovalNonce(externalReceipt, authority, fetchImpl);
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = await verifyProductionReadinessWithAuthority({ candidateSha: args["candidate-sha"], finalAcceptancePath: args["final-acceptance"], externalReceiptPath: args["external-receipt"] });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 64;
  }
}
