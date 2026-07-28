import { describe, expect, it } from "vitest";

import {
  issueExternalActionReceipt,
  parseExternalActionReceiptConfig,
  verifyExternalActionReceipt,
} from "./external-action-release";

const secret = Buffer.alloc(32, 7).toString("base64url");
const env = {
  EXTERNAL_ACTION_RECEIPT_ACTIVE_KEY_ID: "receipt-2026-07",
  EXTERNAL_ACTION_RECEIPT_KEYS_JSON: JSON.stringify({
    "receipt-2026-07": { secret, status: "sign_verify", signingDisabledAt: null },
  }),
};
const claims = {
  action: "sangfor.apply_approved_product_change",
  actorAssignmentId: "assignment-1",
  actorUserId: "user-1",
  approvalId: "approval-1",
  approvalRevision: 1,
  artifactId: "artifact-1",
  artifactVersionId: "version-1",
  artifactVersionNumber: 1,
  aud: "sangfor-engineer-mcp-external-action",
  bodyHash: "a".repeat(64),
  companyId: "company-1",
  idempotencyKey: "issue-1",
  iss: "sangfor-web-external-action-release",
  policyHash: "b".repeat(64),
  projectId: "project-1",
  receiptVersion: "sangfor.external-action-receipt/v1",
  target: "mock://console/config/network",
  tenantId: "tenant-1",
};

describe("external action release receipt", () => {
  it("issues the exact canonical HS256 receipt and rejects forged, padded, expired, and malformed JWS", () => {
    const config = parseExternalActionReceiptConfig(env, 1_700_000_000);
    const receipt = issueExternalActionReceipt(claims, config, {
      now: 1_700_000_000,
      randomBytes: (() => { let value = 0; return () => Buffer.alloc(16, ++value); })(),
    });
    expect(receipt.split(".")).toHaveLength(3);
    expect(verifyExternalActionReceipt(receipt, config, 1_700_000_001)).toMatchObject(claims);
    expect(() => verifyExternalActionReceipt(`${receipt}=`, config, 1_700_000_001)).toThrow();
    expect(() => verifyExternalActionReceipt(receipt.replace(/.$/, "x"), config, 1_700_000_001)).toThrow();
    expect(() => verifyExternalActionReceipt(receipt, config, 1_700_000_066)).toThrow();
  });

  it("fails closed for malformed root key configuration", () => {
    expect(() => parseExternalActionReceiptConfig({ ...env, EXTERNAL_ACTION_RECEIPT_KEYS_JSON: JSON.stringify({ receipt: { secret: "short", status: "sign_verify", signingDisabledAt: null } }) }, 1)).toThrow();
  });
});
