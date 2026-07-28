import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateAcceptanceEnv } from "./run-playwright-acceptance.mjs";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("run-playwright-acceptance", () => {
  it("rejects missing PORT/lease/DATABASE_URL before spawn", () => {
    assert.throws(
      () => validateAcceptanceEnv({}),
      /RESOURCE_LEASE_FILE|required/,
    );
    assert.throws(
      () =>
        validateAcceptanceEnv({
          RESOURCE_LEASE_FILE: "/tmp/nope",
          TASK_OWNER_UNIT: "U007",
          TASK_RUN_ID: "r",
          PORT: "1",
          API_PORT: "1",
        }),
      /differ|required|lease|ENOENT|resource-lease/,
    );
  });

  it("accepts matching lease + loopback task DB + receipt", () => {
    const dir = mkdtempSync(join(tmpdir(), "u007-pw-"));
    chmodSync(dir, 0o700);
    try {
      const leasePath = join(dir, "lease.json");
      writeFileSync(
        leasePath,
        JSON.stringify({
          runId: "run-pw",
          ownerUnit: "U007",
          webPort: 16101,
          apiPort: 16200,
          issuedAt: new Date(Date.now() - 1000).toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }),
      );
      chmodSync(leasePath, 0o600);
      const receiptPath = join(dir, "postgres-receipt.json");
      writeFileSync(
        receiptPath,
        JSON.stringify({
          runId: "run-pw",
          ownerUnit: "U007",
          purpose: "acceptance",
          host: "127.0.0.1",
          port: 5432,
          sentinel: {
            schemaVersion: 1,
            runId: "run-pw",
            ownerUnit: "U007",
            purpose: "acceptance",
            imageDigest: "sha256:" + "a".repeat(64),
          },
        }),
      );
      const v = validateAcceptanceEnv({
        RESOURCE_LEASE_FILE: leasePath,
        TASK_OWNER_UNIT: "U007",
        TASK_RUN_ID: "run-pw",
        PORT: "16101",
        API_PORT: "16200",
        DATABASE_URL:
          "postgresql://u:p@127.0.0.1:5432/sangfor_task_run_pw",
        TASK_POSTGRES_RECEIPT_FILE: receiptPath,
      });
      assert.equal(v.lease.webPort, 16101);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
