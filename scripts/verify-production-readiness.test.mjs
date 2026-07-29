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
  const counts = { total: 1, passed: 1, failed: 0, skipped: 0, fixme: 0, todo: 0, only: 0, flaky: 0, retry: 0, noTestsPhrase: false, parseable: true };
  const gate = {
    schemaVersion: 1,
    candidateSha,
    runId: "u076-final",
    workspace: "services/production-nonce-authority",
    steps: ["lint", "typecheck", "test", "build"].map((command, index) => ({
      id: ["nonce-lint", "nonce-typecheck", "nonce-unit", "nonce-build"][index],
      argv: ["bash", "scripts/run-workspace-runtime.sh", "nonce", "--", "corepack", "pnpm", command],
      exitCode: 0,
      durationMs: 1,
      verdict: "PASS",
      reason: index === 2 ? "strict_test_pass" : "command_exit_0",
      counts: index === 2 ? counts : { ...counts, total: null, passed: null, failed: null, parseable: false },
      outputHash: String(index).repeat(64),
    })),
  };
  const gateBytes = Buffer.from(`${JSON.stringify(gate)}\n`);
  const nonceAuthorityReleaseGateSha256 = createHash("sha256").update(gateBytes).digest("hex");
  writeFileSync(join(directory, "nonce-authority-release-gate.json"), gateBytes);
  const finalAcceptance = { schemaVersion: 1, unit: "U076", candidateSha, runId: "u076-final", state: "LOCAL_PASS_EXTERNAL_PENDING", autonomousPassed: 98, manualPending: 1, innerSummarySha256: "b".repeat(64), detachedMirrorReceiptSha256: "c".repeat(64), nonceAuthorityReleaseGateSha256, scmHandoffSha256: "d".repeat(64), cleanup: "PASS", createdAt: "2026-07-28T00:00:00Z" };
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
      nonceAuthorityReleaseGate: gate,
      nonceAuthorityReleaseGateSha256,
      externalReceipt: {
        schemaVersion: 1, candidateSha, manifestId: "AC-DOD-09", runId: "u076-final", ownerUnit: "U076", localAcceptanceSha256: finalAcceptanceSha256, verificationState: "MANUAL_EXTERNAL_PASS", approvalRequired: true, executed: true, result: "PASS", issuedAt: "2026-07-28T00:02:00Z",
        approval: { id: "approval-1", approvedBy: "release-owner", issuer: approvalIssuer, nonce: "n".repeat(32), approvedAt: "2026-07-28T00:01:00Z" },
        commands: [{ argv: ["connector-smoke", "--read-only"], exitCode: 0, testCount: 1 }],
        artifactHashes: [
          { path: "evidence.json", sha256: createHash("sha256").update(artifact).digest("hex"), bytes: artifact.length },
          { path: "nonce-authority-release-gate.json", sha256: nonceAuthorityReleaseGateSha256, bytes: gateBytes.length },
        ],
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

function persistFixture(value) {
  const gateBytes = Buffer.from(`${JSON.stringify(value.input.nonceAuthorityReleaseGate)}\n`);
  const gateSha256 = createHash("sha256").update(gateBytes).digest("hex");
  value.input.nonceAuthorityReleaseGateSha256 = gateSha256;
  value.input.finalAcceptance.nonceAuthorityReleaseGateSha256 = gateSha256;
  const finalAcceptanceBytes = Buffer.from(`${JSON.stringify(value.input.finalAcceptance)}\n`);
  value.input.finalAcceptanceSha256 = createHash("sha256").update(finalAcceptanceBytes).digest("hex");
  value.input.externalReceipt.localAcceptanceSha256 = value.input.finalAcceptanceSha256;
  const gateArtifact = value.input.externalReceipt.artifactHashes.find((artifact) => artifact.path === "nonce-authority-release-gate.json");
  gateArtifact.sha256 = gateSha256;
  gateArtifact.bytes = gateBytes.length;
  value.input.externalReceipt.signature.value = signProductionApprovalReceipt(value.input.externalReceipt, approvalKeys.privateKey);
  writeFileSync(join(value.directory, "nonce-authority-release-gate.json"), gateBytes);
  writeFileSync(join(value.directory, "final.json"), finalAcceptanceBytes);
  writeFileSync(join(value.directory, "receipt.json"), `${JSON.stringify(value.input.externalReceipt)}\n`);
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
  it("rejects missing, tampered, and malformed nonce authority gate evidence before consuming a nonce", async () => {
    const cases = [
      ["missing final hash", (value) => { delete value.input.finalAcceptance.nonceAuthorityReleaseGateSha256; }],
      ["hash mismatch", (value) => { value.input.finalAcceptance.nonceAuthorityReleaseGateSha256 = "0".repeat(64); }],
      ["legacy lane count", (value) => { value.input.nonceAuthorityReleaseGate.steps.push(...Array.from({ length: 11 }, (_, index) => ({ ...value.input.nonceAuthorityReleaseGate.steps[0], id: `legacy-${index}` }))); }],
      ["wrong lane identity", (value) => { value.input.nonceAuthorityReleaseGate.steps[0].id = "wrong"; }],
      ["missing receipt binding", (value) => { value.input.externalReceipt.artifactHashes = value.input.externalReceipt.artifactHashes.filter((artifact) => artifact.path !== "nonce-authority-release-gate.json"); }],
      ["tampered receipt binding", (value) => { value.input.externalReceipt.artifactHashes[1].sha256 = "0".repeat(64); }],
      ["duplicate receipt binding", (value) => { value.input.externalReceipt.artifactHashes.push({ ...value.input.externalReceipt.artifactHashes[1], sha256: "0".repeat(64) }); }],
    ];
    for (const [_label, mutate] of cases) {
      const value = fixture();
      try {
        mutate(value);
        assert.throws(() => validateProductionReadiness(value.input), /nonce authority release-gate|nonce authority release-gate artifact/u);
      } finally { rmSync(value.directory, { recursive: true }); }
    }

    const value = fixture();
    const authorityPath = join(value.directory, "production-authority.json");
    const privateKeyPath = join(value.directory, "deployment-private.pem");
    writeFileSync(privateKeyPath, deploymentKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    writeFileSync(authorityPath, `${JSON.stringify({ schemaVersion: 1, approvalIssuer, approvalKeys: approvalKeyring, nonceConsumeUrl: "https://approval.internal.test/v1/nonces/consume", nonceConsumeBearerToken: "t".repeat(32), deploymentReceiptKeyId: "deployment-1", deploymentReceiptPrivateKeyPath: privateKeyPath, deploymentReceiptKeys: { "deployment-1": { publicKeyPem: deploymentKeys.publicKey.export({ type: "spki", format: "pem" }), status: "verify" } } })}\n`, { mode: 0o600 });
    let calls = 0;
    try {
      const missingGate = fixture();
      try {
        rmSync(join(missingGate.directory, "nonce-authority-release-gate.json"));
        await assert.rejects(() => verifyProductionReadinessWithAuthority({ candidateSha, finalAcceptancePath: join(missingGate.directory, "final.json"), externalReceiptPath: join(missingGate.directory, "receipt.json"), authorityPath, allowNonRootAuthorityForTests: true, fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); } }), /nonce authority release-gate evidence path/u);
      } finally { rmSync(missingGate.directory, { recursive: true }); }
      const hashMismatch = fixture();
      try {
        hashMismatch.input.finalAcceptance.nonceAuthorityReleaseGateSha256 = "0".repeat(64);
        writeFileSync(join(hashMismatch.directory, "final.json"), `${JSON.stringify(hashMismatch.input.finalAcceptance)}\n`);
        await assert.rejects(() => verifyProductionReadinessWithAuthority({ candidateSha, finalAcceptancePath: join(hashMismatch.directory, "final.json"), externalReceiptPath: join(hashMismatch.directory, "receipt.json"), authorityPath, allowNonRootAuthorityForTests: true, fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); } }), /final acceptance nonce authority release-gate hash invalid/u);
      } finally { rmSync(hashMismatch.directory, { recursive: true }); }
      value.input.nonceAuthorityReleaseGate.steps[0].id = "wrong";
      const malformedGateBytes = Buffer.from(`${JSON.stringify(value.input.nonceAuthorityReleaseGate)}\n`);
      const malformedGateSha256 = createHash("sha256").update(malformedGateBytes).digest("hex");
      value.input.finalAcceptance.nonceAuthorityReleaseGateSha256 = malformedGateSha256;
      writeFileSync(join(value.directory, "nonce-authority-release-gate.json"), malformedGateBytes);
      writeFileSync(join(value.directory, "final.json"), `${JSON.stringify(value.input.finalAcceptance)}\n`);
      await assert.rejects(() => verifyProductionReadinessWithAuthority({ candidateSha, finalAcceptancePath: join(value.directory, "final.json"), externalReceiptPath: join(value.directory, "receipt.json"), authorityPath, allowNonRootAuthorityForTests: true, fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); } }), /nonce authority release-gate evidence invalid/u);
      assert.equal(calls, 0);
    } finally { rmSync(value.directory, { recursive: true }); }
  });
  it("rejects false-green nonce gate PASS semantics before consuming a nonce", async () => {
    const authorityFixture = fixture();
    const authorityPath = join(authorityFixture.directory, "production-authority.json");
    const privateKeyPath = join(authorityFixture.directory, "deployment-private.pem");
    writeFileSync(privateKeyPath, deploymentKeys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    writeFileSync(authorityPath, `${JSON.stringify({ schemaVersion: 1, approvalIssuer, approvalKeys: approvalKeyring, nonceConsumeUrl: "https://approval.internal.test/v1/nonces/consume", nonceConsumeBearerToken: "t".repeat(32), deploymentReceiptKeyId: "deployment-1", deploymentReceiptPrivateKeyPath: privateKeyPath, deploymentReceiptKeys: { "deployment-1": { publicKeyPem: deploymentKeys.publicKey.export({ type: "spki", format: "pem" }), status: "verify" } } })}\n`, { mode: 0o600 });
    const cases = [
      ["failed tests", (gate) => { gate.steps[2].counts.failed = 1; }],
      ["zero total", (gate) => { gate.steps[2].counts.total = 0; gate.steps[2].counts.passed = 0; }],
      ["null total", (gate) => { gate.steps[2].counts.total = null; }],
      ["passed mismatch", (gate) => { gate.steps[2].counts.passed = 2; }],
      ["zero passed", (gate) => { gate.steps[2].counts.passed = 0; }],
      ["skipped tests", (gate) => { gate.steps[2].counts.skipped = 1; }],
      ["unparseable unit output", (gate) => { gate.steps[2].counts.parseable = false; }],
      ["wrong unit reason", (gate) => { gate.steps[2].reason = "command_exit_0"; }],
      ["no tests phrase", (gate) => { gate.steps[2].counts.noTestsPhrase = true; }],
      ["wrong command reason", (gate) => { gate.steps[0].reason = "strict_test_pass"; }],
      ["parseable command output", (gate) => { gate.steps[0].counts.parseable = true; }],
    ];
    let calls = 0;
    try {
      for (const [_label, mutate] of cases) {
        const value = fixture();
        try {
          mutate(value.input.nonceAuthorityReleaseGate);
          persistFixture(value);
          await assert.rejects(() => verifyProductionReadinessWithAuthority({ candidateSha, finalAcceptancePath: join(value.directory, "final.json"), externalReceiptPath: join(value.directory, "receipt.json"), authorityPath, allowNonRootAuthorityForTests: true, fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); } }), /nonce authority release-gate evidence invalid/u);
          assert.equal(calls, 0);
        } finally { rmSync(value.directory, { recursive: true }); }
      }
    } finally { rmSync(authorityFixture.directory, { recursive: true }); }
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
