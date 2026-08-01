#!/usr/bin/env node
/**
 * The pre-cutover operational proof the deployment runbook mandates
 * (docs/12_VERIFICATION/production-deployment-runbook.md): prove the configured
 * nonce authority actually consumes a nonce once and refuses the replay, using a
 * canary that is never a real deployment receipt.
 *
 * Reads the root-owned authority itself so the bearer token never appears in
 * argv, in this process's environment, or in any log line.
 *
 * Must run as root, because the authority file is root-owned 0600 by design.
 */
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

import { canonicalJson, loadProductionAuthority } from "./lib/production-authority.mjs";

const CANARY_PREFIX = "canary";

export class CanaryError extends Error {
  constructor(exitCode, message) {
    super(message);
    this.name = "CanaryError";
    this.exitCode = exitCode;
  }
}

/** Mirrors `consumeApprovalNonce`'s injectable-fetch shape so the refusal paths
 *  can be exercised without a network. */
export async function runCanary(authority, fetchImpl = fetch) {


  // Deliberately not a deployment shape: a canary candidate SHA that is all
  // zeroes could never name a commit, and the run id is prefixed so the consumed
  // row is identifiable as a drill forever after.
  const nonce = `${CANARY_PREFIX}-${randomBytes(24).toString("base64url")}`;
  const request = {
    schemaVersion: 1,
    issuer: authority.approvalIssuer,
    nonce,
    approvalId: `${CANARY_PREFIX}-${Date.now()}`,
    candidateSha: "0".repeat(40),
    runId: `${CANARY_PREFIX}-nonce-proof`,
    receiptSha256: createHash("sha256").update(canonicalJson({ canary: nonce })).digest("hex"),
  };

  const post = async () =>
    fetchImpl(authority.nonceConsumeUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${authority.nonceConsumeBearerToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

  const first = await post();
  const firstBody = await first.json().catch(() => null);
  if (first.status !== 201) throw new CanaryError(70, `first consume returned HTTP ${first.status}, expected 201`);
  if (
    firstBody?.schemaVersion !== 1 ||
    firstBody.consumed !== true ||
    firstBody.nonce !== nonce ||
    firstBody.receiptSha256 !== request.receiptSha256
  ) {
    throw new CanaryError(71, `first consume body did not echo the submission: ${JSON.stringify(firstBody)}`);
  }

  const replay = await post();
  const replayBody = await replay.json().catch(() => null);
  if (replay.status !== 409) throw new CanaryError(72, `replay returned HTTP ${replay.status}, expected 409`);
  if (replayBody?.schemaVersion !== 1 || replayBody.consumed !== false) {
    throw new CanaryError(73, `replay body was not a clean refusal: ${JSON.stringify(replayBody)}`);
  }

  return {
    ok: true,
    issuer: authority.approvalIssuer,
    endpoint: new URL(authority.nonceConsumeUrl).origin,
    firstStatus: first.status,
    replayStatus: replay.status,
    nonce,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCanary(loadProductionAuthority().authority)
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exit(error instanceof CanaryError ? error.exitCode : 74);
    });
}
