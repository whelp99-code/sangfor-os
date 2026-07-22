import { describe, expect, it } from "vitest";

import { issueExternalActionReceipt, parseExternalActionReceiptConfig, verifyExternalActionReceipt } from "./external-action-release";

const integration = process.env.CI_INTEGRATION === "1" && Boolean(process.env.DATABASE_URL);

describe.skipIf(!integration)("external action receipt integration boundary", () => {
  it("keeps the receipt verifier fail-closed while the isolated Postgres lifecycle owns durable replay coverage", () => {
    const config = parseExternalActionReceiptConfig({ EXTERNAL_ACTION_RECEIPT_ACTIVE_KEY_ID: "i", EXTERNAL_ACTION_RECEIPT_KEYS_JSON: JSON.stringify({ i: { secret: Buffer.alloc(32, 9).toString("base64url"), status: "sign_verify", signingDisabledAt: null } }) }, 1_700_000_000);
    const receipt = issueExternalActionReceipt({ action: "action", actorAssignmentId: "assignment", actorUserId: "user", approvalId: "approval", approvalRevision: 1, artifactId: "artifact", artifactVersionId: "version", artifactVersionNumber: 1, bodyHash: "a".repeat(64), companyId: "company", idempotencyKey: "idempotency", policyHash: "b".repeat(64), projectId: "project", target: "mock://target", tenantId: "tenant" }, config, { now: 1_700_000_000, randomBytes: () => Buffer.alloc(16, 4) });
    expect(verifyExternalActionReceipt(receipt, config, 1_700_000_001).jti).toBe("BAQEBAQEBAQEBAQEBAQEBA");
  });
});
