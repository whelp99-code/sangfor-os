import { createHash, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { signProductionApprovalReceipt, validateProductionReadiness, verifyProductionReadinessWithAuthority } from "./verify-production-readiness.mjs";
import { loadProductionAuthority } from "./lib/production-authority.mjs";

const candidateSha = "a".repeat(40);
const approvalKeys = generateKeyPairSync("ed25519");
const deploymentKeys = generateKeyPairSync("ed25519");
const approvalKeyring = { "approval-key-1": { publicKeyPem: approvalKeys.publicKey.export({ type: "spki", format: "pem" }), status: "verify" } };
const approvalIssuer = "trusted-release-owner";

function fixture() {
  const directory = join(tmpdir(), `production-readiness-${process.pid}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(directory);
  const artifact = Buffer.from("redacted external staging evidence\n");
  const finalAcceptance = { schemaVersion: 1, authority: "AUTHORITATIVE_MIRROR_INTERNAL", candidateSha, state: "LOCAL_PASS_EXTERNAL_PENDING", autonomousPassed: 98, manualPending: 1, cleanup: "PASS", runId: "u076-final", contextHash: "b".repeat(64), aliasMapHash: "c".repeat(64), createdAt: "2026-07-28T00:00:00Z" };
  const finalAcceptanceBytes = Buffer.from(`${JSON.stringify(finalAcceptance)}\n`);
  const finalAcceptanceSha256 = createHash("sha256").update(finalAcceptanceBytes).digest("hex");
  writeFileSync(join(directory, "final.json"), finalAcceptanceBytes);
  writeFileSync(join(directory, "evidence.json"), artifact);
  const result = {
    directory,
    input: {
      candidateSha,
      finalAcceptance,
      finalAcceptanceSha256,
      externalReceipt: {
        schemaVersion: 1, candidateSha, manifestId: "AC-DOD-09", runId: "u076-final", ownerUnit: "U076", localAcceptanceSha256: finalAcceptanceSha256, verificationState: "MANUAL_EXTERNAL_PASS", approvalRequired: true, executed: true, result: "PASS", issuedAt: "2026-07-28T00:02:00Z",
        approval: { id: "approval-1", approvedBy: "release-owner", issuer: approvalIssuer, nonce: "n".repeat(32), approvedAt: "2026-07-28T00:01:00Z" },
        commands: [{ argv: ["connector-smoke", "--read-only"], exitCode: 0, testCount: 1 }],
        artifactHashes: [{ path: "evidence.json", sha256: createHash("sha256").update(artifact).digest("hex"), bytes: artifact.length }],
        signature: { keyId: "approval-key-1", algorithm: "Ed25519", value: "" },
      },
      externalReceiptPath: join(directory, "receipt.json"),
      approvalIssuer,
      approvalKeyring,
    },
  };
  result.input.externalReceipt.signature.value = signProductionApprovalReceipt(result.input.externalReceipt, approvalKeys.privateKey);
  writeFileSync(join(directory, "receipt.json"), `${JSON.stringify(result.input.externalReceipt)}\n`);
  return result;
}

describe("production readiness evidence", () => {
  it("accepts candidate-bound local and approved external evidence", () => {
    const value = fixture();
    try { assert.equal(validateProductionReadiness(value.input).ok, true); } finally { rmSync(value.directory, { recursive: true }); }
  });
  it("rejects pending external evidence and stale artifact hashes", () => {
    const value = fixture();
    value.input.externalReceipt.verificationState = "MANUAL_EXTERNAL_PENDING";
    value.input.externalReceipt.artifactHashes[0].sha256 = "0".repeat(64);
    try { assert.throws(() => validateProductionReadiness(value.input), /MANUAL_EXTERNAL_PASS|artifact mismatch/u); } finally { rmSync(value.directory, { recursive: true }); }
  });
  it("rejects reuse against a different local acceptance file or run", () => {
    const value = fixture();
    value.input.externalReceipt.localAcceptanceSha256 = "0".repeat(64);
    value.input.externalReceipt.runId = "stale-run";
    try { assert.throws(() => validateProductionReadiness(value.input), /run identity|exact local acceptance/u); } finally { rmSync(value.directory, { recursive: true }); }
  });
  it("uses the authority file instead of caller environment and consumes remotely exactly once", async () => {
    const value = fixture();
    const authorityPath = join(value.directory, "production-authority.json");
    const privateKeyPath = join(value.directory, "deployment-private.pem");
    writeFileSync(privateKeyPath, deploymentKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    const authority = { schemaVersion: 1, approvalIssuer, approvalKeys: approvalKeyring, nonceConsumeUrl: "https://approval.internal.test/v1/nonces/consume", nonceConsumeBearerToken: "t".repeat(32), deploymentReceiptKeyId: "deployment-1", deploymentReceiptPrivateKeyPath: privateKeyPath, deploymentReceiptKeys: { "deployment-1": { publicKeyPem: deploymentKeys.publicKey.export({ type: "spki", format: "pem" }), status: "verify" } } };
    writeFileSync(authorityPath, `${JSON.stringify(authority)}\n`, { mode: 0o600 });
    chmodSync(authorityPath, 0o600);
    const consumed = new Set();
    const fetchImpl = async (_url, options) => {
      const body = JSON.parse(options.body);
      if (consumed.has(body.nonce)) return { status: 409, json: async () => ({}) };
      consumed.add(body.nonce);
      return { status: 201, json: async () => ({ schemaVersion: 1, consumed: true, nonce: body.nonce, receiptSha256: body.receiptSha256 }) };
    };
    const input = { candidateSha, finalAcceptancePath: join(value.directory, "final.json"), externalReceiptPath: join(value.directory, "receipt.json"), authorityPath, allowNonRootAuthorityForTests: true, fetchImpl };
    const previousIssuer = process.env.PRODUCTION_APPROVAL_ISSUER;
    process.env.PRODUCTION_APPROVAL_ISSUER = "attacker-controlled";
    try {
      assert.equal((await verifyProductionReadinessWithAuthority(input)).ok, true);
      await assert.rejects(() => verifyProductionReadinessWithAuthority(input), /HTTP 409/u);
    } finally {
      if (previousIssuer === undefined) delete process.env.PRODUCTION_APPROVAL_ISSUER;
      else process.env.PRODUCTION_APPROVAL_ISSUER = previousIssuer;
      rmSync(value.directory, { recursive: true });
    }
  });
  it("rejects local and private nonce authorities while accepting remote HTTPS addresses", () => {
    const directory = join(tmpdir(), `production-authority-addresses-${process.pid}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(directory);
    const authorityPath = join(directory, "production-authority.json");
    const privateKeyPath = join(directory, "deployment-private.pem");
    writeFileSync(privateKeyPath, deploymentKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    const authority = (nonceConsumeUrl) => ({ schemaVersion: 1, approvalIssuer, approvalKeys: approvalKeyring, nonceConsumeUrl, nonceConsumeBearerToken: "t".repeat(32), deploymentReceiptKeyId: "deployment-1", deploymentReceiptPrivateKeyPath: privateKeyPath, deploymentReceiptKeys: { "deployment-1": { publicKeyPem: deploymentKeys.publicKey.export({ type: "spki", format: "pem" }), status: "verify" } } });
    const writeAuthority = (nonceConsumeUrl) => writeFileSync(authorityPath, `${JSON.stringify(authority(nonceConsumeUrl))}\n`, { mode: 0o600 });
    const rejected = [
      "https://localhost/v1/consume", "https://localhost./v1/consume", "https://a.localhost/v1/consume", "https://a.localhost./v1/consume",
      "https://0.0.0.0/v1/consume", "https://0.255.255.255/v1/consume", "https://10.0.0.5/v1/consume", "https://127.0.0.2/v1/consume", "https://127.1/v1/consume", "https://2130706433/v1/consume", "https://0x7f.1/v1/consume", "https://169.254.169.254/v1/consume", "https://172.16.0.1/v1/consume", "https://172.31.255.255/v1/consume", "https://192.168.1.1/v1/consume",
      "https://[::]/v1/consume", "https://[::1]/v1/consume", "https://[fe80::1]/v1/consume", "https://[febf::1]/v1/consume", "https://[fc00::1]/v1/consume", "https://[fdff::1]/v1/consume",
      "https://[::ffff:0.0.0.1]/v1/consume", "https://[::ffff:10.0.0.5]/v1/consume", "https://[::ffff:127.0.0.1]/v1/consume", "https://[::ffff:169.254.169.254]/v1/consume", "https://[::ffff:172.16.0.1]/v1/consume", "https://[::ffff:192.168.1.1]/v1/consume",
    ];
    const accepted = [
      "https://nonce.approval.example/v1/consume", "https://8.8.8.8/v1/consume", "https://126.255.255.255/v1/consume", "https://128.0.0.1/v1/consume", "https://172.15.255.255/v1/consume", "https://172.32.0.1/v1/consume", "https://[2606:4700:4700::1111]/v1/consume", "https://[::ffff:8.8.8.8]/v1/consume",
    ];
    try {
      for (const nonceConsumeUrl of rejected) {
        writeAuthority(nonceConsumeUrl);
        assert.throws(() => loadProductionAuthority(authorityPath, { allowNonRootOwner: true }), /must be remote HTTPS/u, nonceConsumeUrl);
      }
      for (const nonceConsumeUrl of accepted) {
        writeAuthority(nonceConsumeUrl);
        assert.equal(loadProductionAuthority(authorityPath, { allowNonRootOwner: true }).authority.nonceConsumeUrl, nonceConsumeUrl);
      }
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
