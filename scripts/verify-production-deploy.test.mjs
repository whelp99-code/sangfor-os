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

function userRing(kid, activatedAt = "2026-01-01T00:00:00Z") {
  return JSON.stringify({ version: "sangfor.user-jwt-keyring/v1", keys: [{ kid, state: "active", secretBase64Url: "A".repeat(43), activatedAt, demotedAt: null, verifyUntil: null, retiredAt: null }] });
}

function internalRing(kid, secretByte, activatedAt = "2026-01-01T00:00:00Z") {
  return JSON.stringify({ version: "sangfor.internal-principal-keyring/v1", keys: [{ kid, state: "active", secretBase64Url: Buffer.alloc(32, secretByte).toString("base64url"), activatedAt, demotedAt: null, verificationCutoff: null, retiredAt: null }] });
}

function validEnvironment() {
  return {
    APP_DOMAIN: "sangfor.internal.test", TAILSCALE_DOMAIN: "blro.example-tailnet.ts.net", BACKUP_DIR: "/var/backups/sangfor-os", DEFAULT_TENANT_ID: "tenant-prod", DEFAULT_TENANT_SLUG: "tenant-prod", DEFAULT_COMPANY_ID: "company-prod", DEFAULT_COMPANY_SLUG: "company-prod", DEFAULT_PROJECT_ID: "project-prod", DEFAULT_PROJECT_SLUG: "project-prod", PRODUCTION_OPERATOR_USER_ID: "operator-prod", PRODUCTION_OPERATOR_EMAIL: "operator-prod@production.sangfor.com", POSTGRES_PASSWORD: "p".repeat(32), SANGFOR_APP_DB_PASSWORD: "a".repeat(32), SANGFOR_RUNTIME_DB_PASSWORD: "t".repeat(32), REDIS_PASSWORD: "r".repeat(32),
    API_KEY: "o".repeat(32), FINANCE_API_KEY: "f".repeat(32), SANGFOR_API_KEY: "s".repeat(32), SANGFOR_OPERATOR_PRINCIPAL_ID: "production-operator",
    JWT_SECRET: "j".repeat(32), USER_JWT_ACTIVE_KID: "user-1", USER_JWT_KEYRING_JSON: userRing("user-1"),
    INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID: "finance-1", INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON: internalRing("finance-1", 1),
    INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID: "scheduler-1", INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON: internalRing("scheduler-1", 2),
    INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID: "workflow-1", INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON: internalRing("workflow-1", 3),
    INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID: "engineer-1", INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON: internalRing("engineer-1", 4),
    EXTERNAL_ACTION_RECEIPT_ACTIVE_KEY_ID: "external-1", EXTERNAL_ACTION_RECEIPT_KEYS_JSON: JSON.stringify({ "external-1": { secret: "C".repeat(43), status: "sign_verify", signingDisabledAt: null } }),
  };
}

function environmentWithTemplateKeyrings() {
  const env = validEnvironment();
  const template = parseEnvFile(readFileSync(new URL("../production.env.example", import.meta.url), "utf8"));
  const keyrings = [
    ["USER_JWT_ACTIVE_KID", "USER_JWT_KEYRING_JSON", 10],
    ["INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID", "INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON", 11],
    ["INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID", "INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON", 12],
    ["INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID", "INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON", 13],
    ["INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID", "INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON", 14],
  ];
  for (const [activeKidKey, keyringKey, secretByte] of keyrings) {
    const keyring = JSON.parse(template[keyringKey]);
    for (const entry of keyring.keys) entry.secretBase64Url = Buffer.alloc(32, secretByte).toString("base64url");
    env[activeKidKey] = template[activeKidKey];
    env[keyringKey] = JSON.stringify(keyring);
  }
  return env;
}

function assertDeploymentPermissionContract(deploy) {
  const permissionCommands = deploy.match(/^\s*(?:chmod|install|chown|chgrp|setfacl|umask)\b.*$/gmu) ?? [];
  assert.deepEqual(permissionCommands, [
    '  chown "$DEPLOYMENT_USER" "$ROOT/.local-prod"',
    '  chown -R "$DEPLOYMENT_USER" "$DEPLOYMENT_RUNTIME_ROOT"',
    'chmod 700 "$ROOT/.local-prod" "$DEPLOYMENT_DIR" "$DEPLOYMENT_RUNTIME_ROOT" "$DEPLOYMENT_SOURCE"',
    'chmod 600 "$DEPLOYMENT_ARCHIVE"',
    'install -m 600 "$DEPLOYMENT_SOURCE/docker-compose.production.yml" "$DEPLOYMENT_COMPOSE"',
    'chmod -R a-w "$DEPLOYMENT_SOURCE"',
    'install -m 600 "$SIGNED_RECEIPT" "$DURABLE_RECEIPT"',
  ], "production deployment permission command allowlist");
  const durable = deploy.indexOf('install -m 600 "$SIGNED_RECEIPT" "$DURABLE_RECEIPT"');
  assert.ok(durable >= 0, "the signed receipt must be copied somewhere that outlives .local-prod");
  assert.ok(deploy.indexOf('DURABLE_RECEIPT="${BACKUP_DIR}/') >= 0, "the durable copy must live beside the backups");
  assert.ok(deploy.indexOf("receipt.mjs\" sign") < durable, "the receipt must be signed before it is copied");
  assert.ok(/^DEPLOYMENT_USER="\$\(stat /mu.test(deploy), "deployment user must be derived from the checkout owner");
  const accessCall = deploy.indexOf("grant_docker_bind_mount_access\n");
  assert.ok(accessCall >= 0, "Docker bind access helper must be called");
  assert.ok(deploy.indexOf("chmod -R a-w \"$DEPLOYMENT_SOURCE\"") < accessCall, "source must be immutable before ownership is handed over");
  assert.ok(accessCall < deploy.indexOf('"${COMPOSE[@]}"'), "Docker bind access must be granted before the first Compose command");
  assert.ok(!/chmod a\+x/u.test(deploy), "bind access must come from ownership, not from widening the mode");
}

function validComposeModel() {
  const runtimeEnvironment = { DATABASE_URL: "postgresql://sangfor_runtime_login@postgres/sangfor?options=-c%20app.tenant_id%3Dtenant-prod", SANGFOR_PROCESS_PROFILE: "production", AUTH_BYPASS_ENABLED: "0", API_KEY_BYPASS_ENABLED: "0", AUTH_PROFILE: "production" };
  const bootstrapEnvironment = { DATABASE_URL: "postgresql://sangfor:admin@postgres/sangfor", DEFAULT_TENANT_ID: "tenant-prod", DEFAULT_TENANT_SLUG: "tenant-prod", DEFAULT_COMPANY_ID: "company-prod", DEFAULT_COMPANY_SLUG: "company-prod", DEFAULT_PROJECT_ID: "project-prod", DEFAULT_PROJECT_SLUG: "project-prod", PRODUCTION_OPERATOR_USER_ID: "operator-prod", PRODUCTION_OPERATOR_EMAIL: "operator-prod@production.sangfor.com", PRODUCTION_OPERATOR_ROLE: "system_admin" };
  return {
    services: {
      postgres: { healthcheck: {}, ports: [] },
      redis: {
        command: ["sh", "-ec", "umask 077\nprintf 'appendonly yes\\nrequirepass %s\\n' \"$$REDIS_PASSWORD\" > /run/redis/redis.conf\nexec redis-server /run/redis/redis.conf"],
        healthcheck: { test: ["CMD-SHELL", "REDISCLI_AUTH=\"$$REDIS_PASSWORD\" redis-cli ping | grep -qx PONG"] },
        ports: [],
        tmpfs: ["/run/redis:mode=0700"],
      },
      backup: { restart: "no" },
      migrate: { restart: "no" },
      bootstrap: { command: ["node", "--import", "tsx", "/app/scripts/provision-production-bootstrap.mjs"], environment: bootstrapEnvironment, volumes: [{ type: "bind", source: "/deployment/scripts/provision-production-bootstrap.mjs", target: "/app/scripts/provision-production-bootstrap.mjs", read_only: true }], depends_on: { migrate: { condition: "service_completed_successfully" } }, restart: "no" },
      "app-role-init": { command: ["ALTER ROLE sangfor_runtime_login NOBYPASSRLS"], depends_on: { bootstrap: { condition: "service_completed_successfully" } }, restart: "no" },
      api: { environment: { ...runtimeEnvironment }, healthcheck: {}, ports: [], volumes: [] },
      web: { environment: { ...runtimeEnvironment }, healthcheck: {}, ports: [], volumes: [] },
      caddy: { environment: { TAILSCALE_DOMAIN: "blro.example-tailnet.ts.net" }, ports: [{ published: 80 }, { published: 443 }] },
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
    assert.deepEqual(validateProductionEnvironment(validEnvironment()), { ok: true, requiredCount: 32 });
  });
  it("requires a dedicated Tailscale HTTPS domain", () => {
    const missing = validEnvironment();
    delete missing.TAILSCALE_DOMAIN;
    assert.throws(() => validateProductionEnvironment(missing), /TAILSCALE_DOMAIN: missing/u);
    assert.throws(() => validateProductionEnvironment({ ...validEnvironment(), TAILSCALE_DOMAIN: "https://blro.example-tailnet.ts.net/" }), /TAILSCALE_DOMAIN: expected hostname/u);
  });
  it("keeps the production environment template aligned with canonical keyring parsers", () => {
    assert.deepEqual(validateProductionEnvironment(environmentWithTemplateKeyrings()), { ok: true, requiredCount: 32 });
  });
  it("rejects the millisecond keyring timestamp that produced production login 503", () => {
    const invalidUser = validEnvironment();
    invalidUser.USER_JWT_KEYRING_JSON = userRing("user-1", "2026-07-29T00:29:12.384Z");
    assert.throws(() => validateProductionEnvironment(invalidUser), /USER_JWT config: .*RFC3339-seconds/u);

    const invalidInternal = validEnvironment();
    invalidInternal.INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON = internalRing("finance-1", 1, "2026-07-29T00:29:12.384Z");
    assert.throws(() => validateProductionEnvironment(invalidInternal), /INTERNAL_PRINCIPAL config: .*RFC3339-seconds/u);
  });
  it("validates operator TTL and clock-skew overrides used by Compose", () => {
    assert.throws(() => validateProductionEnvironment({ ...validEnvironment(), INTERNAL_PRINCIPAL_TTL_SECONDS: "61" }), /INTERNAL_PRINCIPAL_TTL_SECONDS must equal 60/u);
    assert.throws(() => validateProductionEnvironment({ ...validEnvironment(), INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: "6" }), /INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS must equal 5/u);
  });
  it("rejects placeholders, shared secrets, bypasses, and malformed keyrings", () => {
    assert.throws(() => validateProductionEnvironment({ ...validEnvironment(), APP_DOMAIN: "example.com", FINANCE_API_KEY: "o".repeat(32), AUTH_BYPASS_ENABLED: "1", USER_JWT_KEYRING_JSON: "{}" }), /placeholder|must differ|forbidden|active key missing/u);
    assert.throws(() => validateProductionEnvironment({ ...validEnvironment(), PRODUCTION_OPERATOR_EMAIL: "Operator@Sangfor.invalid" }), /canonical lowercase email/u);
    assert.throws(() => validateProductionEnvironment({ ...validEnvironment(), PRODUCTION_OPERATOR_EMAIL: "operator-prod@sangfor.invalid" }), /reserved email domain/u);
    const template = parseEnvFile(readFileSync(new URL("../production.env.example", import.meta.url), "utf8"));
    assert.throws(() => validateProductionEnvironment({ ...validEnvironment(), PRODUCTION_OPERATOR_EMAIL: template.PRODUCTION_OPERATOR_EMAIL }), /reserved email domain/u);
  });
  it("rejects a compose model that exposes data services", () => {
    const services = Object.fromEntries(["postgres", "redis", "migrate", "bootstrap", "app-role-init", "api", "web", "caddy"].map((name) => [name, {}]));
    services.postgres.ports = [{ published: 5432 }];
    assert.throws(() => validateComposeModel({ services }), /postgres: must not publish/u);
  });
  it("rejects Redis credentials passed through process arguments", () => {
    const insecureServer = validComposeModel();
    insecureServer.services.redis.command = ["sh", "-ec", "exec redis-server --appendonly yes --requirepass \"$$REDIS_PASSWORD\""];
    assert.throws(() => validateComposeModel(insecureServer), /redis: credentials must not be passed through process arguments/u);

    const insecureHealthcheck = validComposeModel();
    insecureHealthcheck.services.redis.healthcheck.test = ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" --no-auth-warning ping | grep -qx PONG"];
    assert.throws(() => validateComposeModel(insecureHealthcheck), /redis healthcheck: credentials must not be passed through process arguments/u);
  });
  it("requires the production process profile for both API and web", () => {
    const valid = validComposeModel();
    assert.deepEqual(validateComposeModel(valid), { ok: true, serviceCount: 9 });
    const missingApiProfile = structuredClone(valid);
    delete missingApiProfile.services.api.environment.SANGFOR_PROCESS_PROFILE;
    assert.throws(() => validateComposeModel(missingApiProfile), /api: SANGFOR_PROCESS_PROFILE must be production/u);
    const wrongWebProfile = structuredClone(valid);
    wrongWebProfile.services.web.environment.SANGFOR_PROCESS_PROFILE = "development";
    assert.throws(() => validateComposeModel(wrongWebProfile), /web: SANGFOR_PROCESS_PROFILE must be production/u);
  });
  it("requires Caddy to receive the Tailscale domain", () => {
    const missingTailscaleDomain = validComposeModel();
    delete missingTailscaleDomain.services.caddy.environment.TAILSCALE_DOMAIN;
    assert.throws(() => validateComposeModel(missingTailscaleDomain), /caddy: TAILSCALE_DOMAIN must be configured/u);
  });
  it("requires bootstrap between migration and app-role initialization", () => {
    const missingBootstrapDependency = validComposeModel();
    delete missingBootstrapDependency.services["app-role-init"].depends_on.bootstrap;
    assert.throws(() => validateComposeModel(missingBootstrapDependency), /app-role-init: must wait only for bootstrap completion/u);

    const wrongBootstrapRole = validComposeModel();
    wrongBootstrapRole.services.bootstrap.environment.DATABASE_URL = "postgresql://sangfor_runtime_login:runtime@postgres/sangfor";
    assert.throws(() => validateComposeModel(wrongBootstrapRole), /bootstrap: DATABASE_URL must use the admin database role/u);
  });
  it("requires the exact bootstrap command array, including the TypeScript loader", () => {
    for (const command of [
      ["true", "provision-production-bootstrap.mjs"],
      ["sh", "-c", "node --import tsx /app/scripts/provision-production-bootstrap.mjs"],
      ["node", "/app/scripts/provision-production-bootstrap.mjs"],
      ["node", "--loader", "tsx", "/app/scripts/provision-production-bootstrap.mjs"],
      ["node", "--import", "tsx", "/app/scripts/provision-production-bootstrap.mjs", "--unexpected"],
    ]) {
      const invalid = validComposeModel();
      invalid.services.bootstrap.command = command;
      assert.throws(() => validateComposeModel(invalid), /bootstrap: command must exactly be/u);
    }
  });
  it("deploys and rolls back by immutable image ID with fixed authority scripts", () => {
    const deploy = readFileSync(new URL("./deploy-production.sh", import.meta.url), "utf8");
    const rollback = readFileSync(new URL("./rollback-production.sh", import.meta.url), "utf8");
    const packageManifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const runbook = readFileSync(new URL("../docs/12_VERIFICATION/production-deployment-runbook.md", import.meta.url), "utf8");
    assert.equal(packageManifest.dependencies.tsx, "4.22.4");
    assert.equal(packageManifest.devDependencies.tsx, undefined);
    assert.match(runbook, /corepack pnpm install --prod --frozen-lockfile/u);
    assert.doesNotMatch(deploy, /PRODUCTION_APPROVAL_ISSUER|consume-nonce-dir/u);
    assert.ok(deploy.indexOf("git archive") < deploy.indexOf("verify-production-readiness.mjs"));
    assert.match(deploy, /cd "\$DEPLOYMENT_SOURCE"\n  corepack pnpm install --prod --frozen-lockfile/u);
    assert.ok(deploy.indexOf("tar -xf \"$DEPLOYMENT_ARCHIVE\" -C \"$DEPLOYMENT_SOURCE\"") < deploy.indexOf("corepack pnpm install --prod --frozen-lockfile"));
    assert.ok(deploy.indexOf("corepack pnpm install --prod --frozen-lockfile") < deploy.indexOf("chmod -R a-w \"$DEPLOYMENT_SOURCE\""));
    assertDeploymentPermissionContract(deploy);
    assert.throws(() => assertDeploymentPermissionContract(deploy.replace('chmod 700 "$ROOT/.local-prod" "$DEPLOYMENT_DIR" "$DEPLOYMENT_RUNTIME_ROOT" "$DEPLOYMENT_SOURCE"', 'chmod 755 "$DEPLOYMENT_DIR"')), /permission command allowlist/u);
    assert.throws(() => assertDeploymentPermissionContract(deploy.replace('chmod 600 "$DEPLOYMENT_ARCHIVE"', 'chmod 600 "$DEPLOYMENT_ARCHIVE"\nchmod a+r "$DEPLOYMENT_ARCHIVE"')), /permission command allowlist/u);
    assert.ok(deploy.indexOf("corepack pnpm install --prod --frozen-lockfile") < deploy.indexOf("production-deployment-receipt.mjs\" preflight"));
    assert.ok(deploy.indexOf("production-deployment-receipt.mjs\" preflight") < deploy.indexOf("verify-production-readiness.mjs"));
    assert.match(deploy, /--project-directory "\$DEPLOYMENT_SOURCE"/u);
    assert.match(deploy, /production-deployment-receipt\.mjs" sign/u);
    assert.match(deploy, /docker image inspect --format '\{\{\.Id\}\}'/u);
    assert.match(deploy, /export API_IMAGE_REF="\$API_IMAGE_ID"/u);
    assert.match(rollback, /docker image inspect "\$API_ID" "\$WEB_ID"/u);
    assert.match(rollback, /export API_IMAGE_REF="\$API_ID"/u);
    assert.match(rollback, /production-deployment-receipt\.mjs verify/u);
  });
  it("preserves an authority verifier exit 64 through the rollback shell", () => {
    const directory = mkdtempSync(join(tmpdir(), "rollback-exit-code-"));
    const binDirectory = join(directory, "bin");
    const receiptPath = join(directory, "receipt.json");
    mkdirSync(binDirectory);
    writeFileSync(receiptPath, "{}\n");
    const nodeStub = join(binDirectory, "node");
    writeFileSync(nodeStub, `#!/bin/sh
case "$1" in
  scripts/verify-production-deploy.mjs) printf '%s\\n' '{"appDomain":"rollback.invalid","apiImage":"api","webImage":"web"}'; exit 0 ;;
  scripts/production-deployment-receipt.mjs) printf '%s\\n' 'authority unavailable' >&2; exit 64 ;;
  -e)
    case "$2" in
      *appDomain*) printf '%s' 'rollback.invalid' ;;
      *apiImage*) printf '%s' 'api' ;;
      *webImage*) printf '%s' 'web' ;;
      *) exit 70 ;;
    esac
    exit 0 ;;
  *) exit 71 ;;
esac
`);
    chmodSync(nodeStub, 0o700);
    for (const command of ["docker", "curl", "tar"]) {
      const path = join(binDirectory, command);
      writeFileSync(path, "#!/bin/sh\nexit 99\n");
      chmodSync(path, 0o700);
    }
    try {
      const result = spawnSync("bash", [new URL("./rollback-production.sh", import.meta.url).pathname, "--env-file", join(directory, "unused.env"), "--project-name", "rollback-test", "--receipt", receiptPath, "--confirm-rollback"], { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, PATH: `${binDirectory}:${process.env.PATH}` } });
      assert.equal(result.status, 64, result.stderr);
      assert.match(result.stderr, /authority unavailable/u);
    } finally {
      rmSync(directory, { recursive: true });
    }
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
        assert.equal(result.serviceCount, 9);
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
