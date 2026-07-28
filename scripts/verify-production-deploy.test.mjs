import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseEnvFile, validateComposeModel, validateProductionEnvironment, verifyProductionDeploy } from "./verify-production-deploy.mjs";
import { deploymentAuthoritySha256, preflightDeploymentSigningAuthority, signDeploymentReceipt, verifyDeploymentReceipt } from "./lib/production-authority.mjs";
import { validateDeploymentReceipt } from "./production-deployment-receipt.mjs";

function ring(version, kid, profile) {
  return JSON.stringify({ version, ...(profile ? { profile } : {}), keys: [{ kid, state: "active", secretBase64Url: "A".repeat(43), activatedAt: "2026-01-01T00:00:00Z", demotedAt: null, verifyUntil: null, retiredAt: null }] });
}

function validEnvironment() {
  return {
    APP_DOMAIN: "sangfor.internal.test", BACKUP_DIR: "/var/backups/sangfor-os", DEFAULT_TENANT_ID: "tenant-prod", DEFAULT_COMPANY_ID: "company-prod", DEFAULT_PROJECT_ID: "project-prod", DEFAULT_PROJECT_SLUG: "project-prod", POSTGRES_PASSWORD: "p".repeat(32), SANGFOR_APP_DB_PASSWORD: "a".repeat(32), SANGFOR_RUNTIME_DB_PASSWORD: "t".repeat(32), REDIS_PASSWORD: "r".repeat(32),
    API_KEY: "o".repeat(32), FINANCE_API_KEY: "f".repeat(32), SANGFOR_API_KEY: "s".repeat(32), SANGFOR_OPERATOR_PRINCIPAL_ID: "production-operator",
    JWT_SECRET: "j".repeat(32), USER_JWT_ACTIVE_KID: "user-1", USER_JWT_KEYRING_JSON: ring("sangfor.user-jwt-keyring/v1", "user-1"),
    INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID: "finance-1", INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: ring("sangfor.internal-principal-keyring/v1", "finance-1", "FINANCE"),
    INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID: "scheduler-1", INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON: ring("sangfor.internal-principal-keyring/v1", "scheduler-1", "SCHEDULER"),
    INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: "workflow-1", INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: ring("sangfor.internal-principal-keyring/v1", "workflow-1", "WORKFLOW"),
    INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID: "engineer-1", INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: ring("sangfor.internal-principal-keyring/v1", "engineer-1", "ENGINEER"),
    EXTERNAL_ACTION_RECEIPT_ACTIVE_KEY_ID: "external-1", EXTERNAL_ACTION_RECEIPT_KEYS_JSON: JSON.stringify({ "external-1": { secret: "C".repeat(43), status: "sign_verify", signingDisabledAt: null } }),
  };
}

function validComposeModel() {
  const runtimeEnvironment = { DATABASE_URL: "postgresql://sangfor_runtime_login@postgres/sangfor?options=-c%20app.tenant_id%3Dtenant-prod", SANGFOR_PROCESS_PROFILE: "production", AUTH_BYPASS_ENABLED: "0", API_KEY_BYPASS_ENABLED: "0", AUTH_PROFILE: "production" };
  return {
    services: {
      postgres: { healthcheck: {}, ports: [] },
      redis: { healthcheck: {}, ports: [] },
      backup: { restart: "no" },
      migrate: { restart: "no" },
      "app-role-init": { command: ["ALTER ROLE sangfor_runtime_login NOBYPASSRLS"], restart: "no" },
      api: { environment: { ...runtimeEnvironment }, healthcheck: {}, ports: [], volumes: [] },
      web: { environment: { ...runtimeEnvironment }, healthcheck: {}, ports: [], volumes: [] },
      caddy: { ports: [{ published: 80 }, { published: 443 }] },
    },
    networks: { backend: { internal: true } },
  };
}

describe("production deploy verifier", () => {
  it("parses comments and quoted values without evaluating shell", () => {
    assert.deepEqual(parseEnvFile("# comment\nAPP_DOMAIN='example.test'\nVALUE=plain\n"), { APP_DOMAIN: "example.test", VALUE: "plain" });
    assert.throws(() => parseEnvFile("export BAD=value"), /invalid env syntax/);
  });
  it("accepts complete, distinct production credentials", () => {
    assert.deepEqual(validateProductionEnvironment(validEnvironment()), { ok: true, requiredCount: 27 });
  });
  it("rejects placeholders, shared secrets, bypasses, and malformed keyrings", () => {
    assert.throws(() => validateProductionEnvironment({ ...validEnvironment(), APP_DOMAIN: "example.com", FINANCE_API_KEY: "o".repeat(32), AUTH_BYPASS_ENABLED: "1", USER_JWT_KEYRING_JSON: "{}" }), /placeholder|must differ|forbidden|active key missing/u);
  });
  it("rejects a compose model that exposes data services", () => {
    const services = Object.fromEntries(["postgres", "redis", "migrate", "app-role-init", "api", "web", "caddy"].map((name) => [name, {}]));
    services.postgres.ports = [{ published: 5432 }];
    assert.throws(() => validateComposeModel({ services }), /postgres: must not publish/u);
  });
  it("requires the production process profile for both API and web", () => {
    const valid = validComposeModel();
    assert.deepEqual(validateComposeModel(valid), { ok: true, serviceCount: 8 });
    const missingApiProfile = structuredClone(valid);
    delete missingApiProfile.services.api.environment.SANGFOR_PROCESS_PROFILE;
    assert.throws(() => validateComposeModel(missingApiProfile), /api: SANGFOR_PROCESS_PROFILE must be production/u);
    const wrongWebProfile = structuredClone(valid);
    wrongWebProfile.services.web.environment.SANGFOR_PROCESS_PROFILE = "development";
    assert.throws(() => validateComposeModel(wrongWebProfile), /web: SANGFOR_PROCESS_PROFILE must be production/u);
  });
  it("deploys and rolls back by immutable image ID with fixed authority scripts", () => {
    const deploy = readFileSync(new URL("./deploy-production.sh", import.meta.url), "utf8");
    const rollback = readFileSync(new URL("./rollback-production.sh", import.meta.url), "utf8");
    assert.doesNotMatch(deploy, /PRODUCTION_APPROVAL_ISSUER|consume-nonce-dir/u);
    assert.ok(deploy.indexOf("git archive") < deploy.indexOf("verify-production-readiness.mjs"));
    assert.ok(deploy.indexOf("production-deployment-receipt.mjs\" preflight") < deploy.indexOf("verify-production-readiness.mjs"));
    assert.match(deploy, /--project-directory "\$DEPLOYMENT_SOURCE"/u);
    assert.match(deploy, /production-deployment-receipt\.mjs" sign/u);
    assert.match(deploy, /docker image inspect --format '\{\{\.Id\}\}'/u);
    assert.match(deploy, /export API_IMAGE_REF="\$API_IMAGE_ID"/u);
    assert.match(rollback, /docker image inspect "\$API_ID" "\$WEB_ID"/u);
    assert.match(rollback, /export API_IMAGE_REF="\$API_ID"/u);
    assert.match(rollback, /production-deployment-receipt\.mjs verify/u);
  });
  it("cryptographically rejects a tampered deployment receipt or compose artifact", () => {
    const directory = mkdtempSync(join(tmpdir(), "deployment-receipt-"));
    const keys = generateKeyPairSync("ed25519");
    const privateKeyPath = join(directory, "private.pem");
    const composePath = join(directory, "deploy.compose.yml");
    const sourceArchivePath = join(directory, "deploy.source.tar");
    writeFileSync(privateKeyPath, keys.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    writeFileSync(composePath, "services: {}\n", { mode: 0o600 });
    writeFileSync(sourceArchivePath, "immutable source archive", { mode: 0o600 });
    const authority = { schemaVersion: 1, deploymentReceiptKeyId: "host-1", deploymentReceiptPrivateKeyPath: privateKeyPath, deploymentReceiptKeys: { "host-1": { publicKeyPem: keys.publicKey.export({ type: "spki", format: "pem" }), status: "verify" } } };
    const authoritySha256 = deploymentAuthoritySha256(authority, "host-1");
    const receipt = { schemaVersion: 3, candidateSha: "a".repeat(40), projectName: "prod", imageTags: { api: `api:${"a".repeat(40)}`, web: `web:${"a".repeat(40)}` }, imageIds: { api: `sha256:${"b".repeat(64)}`, web: `sha256:${"c".repeat(64)}` }, composeArtifact: "deploy.compose.yml", composeSha256: createHash("sha256").update(readFileSync(composePath)).digest("hex"), sourceArchive: "deploy.source.tar", sourceArchiveSha256: createHash("sha256").update(readFileSync(sourceArchivePath)).digest("hex"), sourceDirectory: "deploy-source", authoritySha256 };
    try {
      assert.equal(preflightDeploymentSigningAuthority(authority, { allowNonRootOwner: true }).keyId, "host-1");
      const mismatchedKeys = generateKeyPairSync("ed25519");
      assert.throws(() => preflightDeploymentSigningAuthority({ ...authority, deploymentReceiptKeys: { "host-1": { publicKeyPem: mismatchedKeys.publicKey.export({ type: "spki", format: "pem" }), status: "verify" } } }, { allowNonRootOwner: true }), /signature invalid/u);
      const signed = signDeploymentReceipt(receipt, authority, { allowNonRootOwner: true });
      const rotatedKeys = generateKeyPairSync("ed25519");
      const rotatedAuthority = { ...authority, deploymentReceiptKeyId: "host-2", deploymentReceiptKeys: { ...authority.deploymentReceiptKeys, "host-2": { publicKeyPem: rotatedKeys.publicKey.export({ type: "spki", format: "pem" }), status: "verify" } } };
      assert.equal(validateDeploymentReceipt(verifyDeploymentReceipt(signed, rotatedAuthority), { projectName: "prod", apiImage: "api", webImage: "web", composePath, sourceArchivePath, authoritySha256: deploymentAuthoritySha256(rotatedAuthority, signed.signature.keyId) }).candidateSha, receipt.candidateSha);
      assert.throws(() => verifyDeploymentReceipt({ ...signed, imageIds: { ...signed.imageIds, api: `sha256:${"e".repeat(64)}` } }, authority), /signature invalid/u);
      writeFileSync(composePath, "services:\n  attacker: {}\n");
      assert.throws(() => validateDeploymentReceipt(signed, { projectName: "prod", apiImage: "api", webImage: "web", composePath, sourceArchivePath, authoritySha256 }), /compose artifact mismatch/u);
      writeFileSync(composePath, "services: {}\n");
      writeFileSync(sourceArchivePath, "tampered source archive");
      assert.throws(() => validateDeploymentReceipt(signed, { projectName: "prod", apiImage: "api", webImage: "web", composePath, sourceArchivePath, authoritySha256 }), /source archive mismatch/u);
    } finally {
      rmSync(directory, { recursive: true });
    }
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
        const copiedCompose = join(directory, "retained.compose.yml");
        writeFileSync(copiedCompose, readFileSync(new URL("../docker-compose.production.yml", import.meta.url)));
        const rendered = spawnSync("docker", ["compose", "--project-directory", new URL("..", import.meta.url).pathname, "--env-file", envFile, "-f", copiedCompose, "config", "--format", "json"], { encoding: "utf8", env: { PATH: process.env.PATH, APP_DOMAIN: "ambient.sangfor.internal.test" } });
        assert.equal(rendered.status, 0, rendered.stderr);
        assert.equal(JSON.parse(rendered.stdout).services.api.build.context, new URL("..", import.meta.url).pathname.replace(/\/$/u, ""));
      } finally {
        if (previousDomain === undefined) delete process.env.APP_DOMAIN;
        else process.env.APP_DOMAIN = previousDomain;
        rmSync(directory, { recursive: true });
      }
    });
  }
});
