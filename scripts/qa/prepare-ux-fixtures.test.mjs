import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import {
  BUSINESS_ROLES,
  FIXTURE_IDS,
  FIXTURE_SCHEMA_VERSION,
  buildStorageState,
  roleIdentity,
  validateSafetyEnvironment,
  writeFixtureArtifacts,
} from "./prepare-ux-fixtures.mjs";

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixtureDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "u066-fixtures-"));
  temporaryDirectories.push(directory);
  return directory;
}

function taskReceipt(directory, overrides = {}) {
  const file = join(directory, "postgres-receipt.json");
  writeFileSync(file, JSON.stringify({
    schemaVersion: 1,
    runId: "u066-test",
    ownerUnit: "U066",
    purpose: "ux-fixtures",
    host: "127.0.0.1",
    port: 5432,
    databaseName: "sangfor_task_u066_test",
    imageDigest: `sha256:${"a".repeat(64)}`,
    migrate: true,
    cleanupState: "open",
    sentinel: {
      schemaVersion: 1,
      runId: "u066-test",
      ownerUnit: "U066",
      purpose: "ux-fixtures",
      imageDigest: `sha256:${"a".repeat(64)}`,
    },
    ...overrides,
  }));
  return file;
}

function validEnvironment(receiptFile) {
  const databaseUrl = "postgresql://u:p@127.0.0.1:5432/sangfor_task_u066_test";
  return {
    DATABASE_URL: databaseUrl,
    TASK_OWNED_DATABASE_URL: databaseUrl,
    TASK_POSTGRES_RECEIPT_FILE: receiptFile,
    TASK_OWNER_UNIT: "U066",
    TASK_RUN_ID: "u066-test",
  };
}

describe("prepare-ux-fixtures safety contract", () => {
  it("requires the isolated-runner URL, owner, run, and receipt", () => {
    assert.throws(() => validateSafetyEnvironment({}), /DATABASE_URL is required/);
    assert.throws(
      () => validateSafetyEnvironment({ DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/sangfor_task_u066_test" }),
      /TASK_OWNED_DATABASE_URL is required/,
    );
  });

  it("rejects production, shared, and caller-mismatched databases", () => {
    const directory = fixtureDirectory();
    const receiptFile = taskReceipt(directory);
    const valid = validEnvironment(receiptFile);
    assert.throws(() => validateSafetyEnvironment({ ...valid, NODE_ENV: "production" }), /production environment is forbidden/);
    assert.throws(() => validateSafetyEnvironment({ ...valid, DATABASE_URL: "postgresql://u:p@db.internal:5432/sangfor_task_u066_test" }), /exactly match/);
    assert.throws(() => validateSafetyEnvironment({ ...valid, DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/sangfor" }), /exactly match/);
    assert.throws(() => validateSafetyEnvironment({ ...valid, TASK_OWNER_UNIT: "U007" }), /TASK_OWNER_UNIT must be U066/);
  });

  it("accepts only a matching open migrated U066 receipt", () => {
    const directory = fixtureDirectory();
    const receiptFile = taskReceipt(directory);
    const safety = validateSafetyEnvironment(validEnvironment(receiptFile));
    assert.equal(safety.databaseName, "sangfor_task_u066_test");
    assert.match(safety.postgresReceiptSha256, /^[a-f0-9]{64}$/);

    writeFileSync(receiptFile, JSON.stringify({
      ...JSON.parse(readFileSync(receiptFile, "utf8")),
      migrate: false,
    }));
    assert.throws(() => validateSafetyEnvironment(validEnvironment(receiptFile)), /must confirm migrations/);
  });

  it("accepts U076 only in explicit final-release fixture mode", () => {
    const directory = fixtureDirectory();
    const receiptFile = taskReceipt(directory);
    const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
    receipt.runId = "u076-test";
    receipt.ownerUnit = "U076";
    receipt.databaseName = "sangfor_task_u076_test";
    receipt.sentinel = { ...receipt.sentinel, runId: "u076-test", ownerUnit: "U076" };
    writeFileSync(receiptFile, JSON.stringify(receipt));
    const databaseUrl = "postgresql://u:p@127.0.0.1:5432/sangfor_task_u076_test";
    const environment = {
      DATABASE_URL: databaseUrl,
      TASK_OWNED_DATABASE_URL: databaseUrl,
      TASK_POSTGRES_RECEIPT_FILE: receiptFile,
      TASK_OWNER_UNIT: "U076",
      TASK_RUN_ID: "u076-test",
      UX_FIXTURE_MODE: "u076-final",
    };
    assert.equal(validateSafetyEnvironment(environment).ownerUnit, "U076");
    assert.throws(() => validateSafetyEnvironment({ ...environment, UX_FIXTURE_MODE: undefined }), /U066/);
  });
});

describe("prepare-ux-fixtures deterministic artifact contract", () => {
  it("defines exactly 12 fixture IDs and ten unique role identities", () => {
    assert.equal(Object.keys(FIXTURE_IDS).length, 12);
    assert.equal(BUSINESS_ROLES.length, 10);
    assert.equal(new Set(BUSINESS_ROLES.map((role) => roleIdentity(role).userId)).size, 10);
    assert.equal(new Set(BUSINESS_ROLES.map((role) => roleIdentity(role).sessionId)).size, 10);
  });

  it("writes ten Playwright states plus env and receipt files", () => {
    const directory = fixtureDirectory();
    const receiptFile = taskReceipt(directory);
    const safety = validateSafetyEnvironment(validEnvironment(receiptFile));
    const issuedAt = new Date("2026-07-26T00:00:00.000Z");
    const expiresAt = new Date("2026-07-26T00:15:00.000Z");
    const tokens = new Map(BUSINESS_ROLES.map((role) => [role, `token-${role}`]));
    const result = writeFixtureArtifacts({
      outputDirectory: join(directory, "output"),
      safety,
      tokens,
      issuedAt,
      expiresAt,
      activeKid: "u066-test-key",
    });

    for (const role of BUSINESS_ROLES) {
      const state = JSON.parse(readFileSync(join(result.storageStateDirectory, `${role}.json`), "utf8"));
      assert.deepEqual(state, buildStorageState(`token-${role}`, expiresAt));
    }
    const env = readFileSync(result.envFile, "utf8");
    assert.match(env, /UX_AUTH_STORAGE_STATE_DIR=/);
    for (const [key, value] of Object.entries(FIXTURE_IDS)) {
      assert.match(env, new RegExp(`${key}=${JSON.stringify(value)}`));
    }
    const receipt = JSON.parse(readFileSync(result.receiptFile, "utf8"));
    assert.equal(receipt.schemaVersion, FIXTURE_SCHEMA_VERSION);
    assert.equal(receipt.fixtureCount, 12);
    assert.equal(receipt.authProfileCount, 10);
    assert.equal(receipt.authProfiles.length, 10);
    assert.equal("DATABASE_URL" in receipt.env, false);
  });
});
