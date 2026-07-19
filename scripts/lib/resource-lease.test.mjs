import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadAndValidateResourceLease,
  validateLeaseAgainstEnv,
} from "./resource-lease.mjs";

function futureIso(msFromNow) {
  return new Date(Date.now() + msFromNow).toISOString();
}

function pastIso(msAgo) {
  return new Date(Date.now() - msAgo).toISOString();
}

describe("resource-lease", () => {
  /** @type {string} */
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "u007-lease-"));
    chmodSync(dir, 0o700);
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function writeLease(name, body) {
    const p = join(dir, name);
    writeFileSync(p, JSON.stringify(body), { mode: 0o600 });
    chmodSync(p, 0o600);
    return p;
  }

  it("accepts valid lease", () => {
    const p = writeLease("ok.json", {
      runId: "run-1",
      ownerUnit: "U007",
      webPort: 13101,
      apiPort: 13200,
      issuedAt: pastIso(60_000),
      expiresAt: futureIso(3_600_000),
    });
    const lease = loadAndValidateResourceLease(p, { expectedOwnerUnit: "U007" });
    assert.equal(lease.ownerUnit, "U007");
    assert.equal(lease.webPort, 13101);
    assert.match(lease.sha256, /^[0-9a-f]{64}$/);
  });

  it("rejects unknown field, same ports, expired, future issuedAt", () => {
    assert.throws(
      () =>
        loadAndValidateResourceLease(
          writeLease("extra.json", {
            runId: "r",
            ownerUnit: "U007",
            webPort: 1,
            apiPort: 2,
            issuedAt: pastIso(1000),
            expiresAt: futureIso(10000),
            extra: true,
          }),
          { expectedOwnerUnit: "U007" },
        ),
      /unknown field/,
    );

    assert.throws(
      () =>
        loadAndValidateResourceLease(
          writeLease("same.json", {
            runId: "r",
            ownerUnit: "U007",
            webPort: 5,
            apiPort: 5,
            issuedAt: pastIso(1000),
            expiresAt: futureIso(10000),
          }),
          { expectedOwnerUnit: "U007" },
        ),
      /must differ/,
    );

    assert.throws(
      () =>
        loadAndValidateResourceLease(
          writeLease("exp.json", {
            runId: "r",
            ownerUnit: "U007",
            webPort: 1,
            apiPort: 2,
            issuedAt: pastIso(10_000),
            expiresAt: pastIso(1000),
          }),
          { expectedOwnerUnit: "U007" },
        ),
      /expired/,
    );

    assert.throws(
      () =>
        loadAndValidateResourceLease(
          writeLease("fut.json", {
            runId: "r",
            ownerUnit: "U007",
            webPort: 1,
            apiPort: 2,
            issuedAt: futureIso(60_000),
            expiresAt: futureIso(120_000),
          }),
          { expectedOwnerUnit: "U007" },
        ),
      /future/,
    );
  });

  it("rejects owner/run/port env mismatch", () => {
    const p = writeLease("env.json", {
      runId: "run-x",
      ownerUnit: "U007",
      webPort: 14001,
      apiPort: 14002,
      issuedAt: pastIso(1000),
      expiresAt: futureIso(60_000),
    });
    assert.throws(
      () =>
        validateLeaseAgainstEnv(
          {
            TASK_OWNER_UNIT: "U008",
            TASK_RUN_ID: "run-x",
            PORT: "14001",
            API_PORT: "14002",
          },
          p,
        ),
      /ownerUnit mismatch/,
    );
    assert.throws(
      () =>
        validateLeaseAgainstEnv(
          {
            TASK_OWNER_UNIT: "U007",
            TASK_RUN_ID: "run-y",
            PORT: "14001",
            API_PORT: "14002",
          },
          p,
        ),
      /runId mismatch/,
    );
    assert.throws(
      () =>
        validateLeaseAgainstEnv(
          {
            TASK_OWNER_UNIT: "U007",
            TASK_RUN_ID: "run-x",
            PORT: "14099",
            API_PORT: "14002",
          },
          p,
        ),
      /webPort mismatch/,
    );
  });

  it("rejects missing TASK_OWNER_UNIT / lease file", () => {
    assert.throws(
      () => validateLeaseAgainstEnv({ PORT: "1", API_PORT: "2" }, "/tmp/nope"),
      /TASK_OWNER_UNIT|missing|ENOENT|resource-lease/,
    );
  });
});
