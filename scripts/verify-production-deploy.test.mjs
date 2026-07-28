import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseEnvFile, validateComposeModel, validateProductionEnvironment, verifyProductionDeploy } from "./verify-production-deploy.mjs";

const approvalPublicKeyPem = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" });

function ring(version, kid, profile) {
  return JSON.stringify({ version, ...(profile ? { profile } : {}), keys: [{ kid, state: "active", secretBase64Url: "A".repeat(43), activatedAt: "2026-01-01T00:00:00Z", demotedAt: null, verifyUntil: null, retiredAt: null }] });
}

function validEnvironment() {
  return {
    APP_DOMAIN: "sangfor.internal.test", BACKUP_DIR: "/var/backups/sangfor-os", DEFAULT_TENANT_ID: "tenant-prod", DEFAULT_COMPANY_ID: "company-prod", DEFAULT_PROJECT_ID: "project-prod", DEFAULT_PROJECT_SLUG: "project-prod", PRODUCTION_APPROVAL_ISSUER: "release-owner", PRODUCTION_APPROVAL_PUBLIC_KEYS_JSON: JSON.stringify({ "approval-1": { publicKeyPem: approvalPublicKeyPem, status: "verify" } }), POSTGRES_PASSWORD: "p".repeat(32), SANGFOR_APP_DB_PASSWORD: "a".repeat(32), SANGFOR_RUNTIME_DB_PASSWORD: "t".repeat(32), REDIS_PASSWORD: "r".repeat(32),
    API_KEY: "o".repeat(32), FINANCE_API_KEY: "f".repeat(32), SANGFOR_API_KEY: "s".repeat(32), SANGFOR_OPERATOR_PRINCIPAL_ID: "production-operator",
    JWT_SECRET: "j".repeat(32), USER_JWT_ACTIVE_KID: "user-1", USER_JWT_KEYRING_JSON: ring("sangfor.user-jwt-keyring/v1", "user-1"),
    INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID: "finance-1", INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: ring("sangfor.internal-principal-keyring/v1", "finance-1", "FINANCE"),
    INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID: "scheduler-1", INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON: ring("sangfor.internal-principal-keyring/v1", "scheduler-1", "SCHEDULER"),
    INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: "workflow-1", INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: ring("sangfor.internal-principal-keyring/v1", "workflow-1", "WORKFLOW"),
    INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID: "engineer-1", INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: ring("sangfor.internal-principal-keyring/v1", "engineer-1", "ENGINEER"),
    EXTERNAL_ACTION_RECEIPT_ACTIVE_KEY_ID: "external-1", EXTERNAL_ACTION_RECEIPT_KEYS_JSON: JSON.stringify({ "external-1": { secret: "C".repeat(43), status: "sign_verify", signingDisabledAt: null } }),
  };
}

describe("production deploy verifier", () => {
  it("parses comments and quoted values without evaluating shell", () => {
    assert.deepEqual(parseEnvFile("# comment\nAPP_DOMAIN='example.test'\nVALUE=plain\n"), { APP_DOMAIN: "example.test", VALUE: "plain" });
    assert.throws(() => parseEnvFile("export BAD=value"), /invalid env syntax/);
  });
  it("accepts complete, distinct production credentials", () => {
    assert.deepEqual(validateProductionEnvironment(validEnvironment()), { ok: true, requiredCount: 29 });
  });
  it("rejects placeholders, shared secrets, bypasses, and malformed keyrings", () => {
    assert.throws(() => validateProductionEnvironment({ ...validEnvironment(), APP_DOMAIN: "example.com", FINANCE_API_KEY: "o".repeat(32), AUTH_BYPASS_ENABLED: "1", USER_JWT_KEYRING_JSON: "{}" }), /placeholder|must differ|forbidden|active key missing/u);
  });
  it("rejects a compose model that exposes data services", () => {
    const services = Object.fromEntries(["postgres", "redis", "migrate", "app-role-init", "api", "web", "caddy"].map((name) => [name, {}]));
    services.postgres.ports = [{ published: 5432 }];
    assert.throws(() => validateComposeModel({ services }), /postgres: must not publish/u);
  });
  it("deploys and rolls back by immutable image ID after signed nonce consumption", () => {
    const deploy = readFileSync(new URL("./deploy-production.sh", import.meta.url), "utf8");
    const rollback = readFileSync(new URL("./rollback-production.sh", import.meta.url), "utf8");
    assert.match(deploy, /--consume-nonce-dir/u);
    assert.match(deploy, /docker image inspect --format '\{\{\.Id\}\}'/u);
    assert.match(deploy, /export API_IMAGE_REF="\$API_IMAGE_ID"/u);
    assert.match(rollback, /docker image inspect "\$API_ID" "\$WEB_ID"/u);
    assert.match(rollback, /export API_IMAGE_REF="\$API_ID"/u);
  });

  if (process.env.RUN_DOCKER_COMPOSE_CONTRACT === "1") {
    it("renders and validates the real production Compose model", () => {
      const directory = mkdtempSync(join(tmpdir(), "sangfor-production-contract-"));
      const envFile = join(directory, ".env.production");
      const backupDirectory = join(directory, "backups");
      mkdirSync(backupDirectory, { mode: 0o700 });
      writeFileSync(envFile, `${Object.entries({ ...validEnvironment(), BACKUP_DIR: backupDirectory }).map(([key, value]) => `${key}=${value}`).join("\n")}\n`);
      chmodSync(envFile, 0o600);
      const previousDomain = process.env.APP_DOMAIN;
      process.env.APP_DOMAIN = "ambient.sangfor.internal.test";
      try {
        const result = verifyProductionDeploy(envFile);
        assert.equal(result.serviceCount, 8);
        assert.equal(result.appDomain, "ambient.sangfor.internal.test");
      } finally {
        if (previousDomain === undefined) delete process.env.APP_DOMAIN;
        else process.env.APP_DOMAIN = previousDomain;
        rmSync(directory, { recursive: true });
      }
    });
  }
});
