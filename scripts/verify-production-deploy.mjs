import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(root, "docker-compose.production.yml");
const placeholderPattern = /(replace|placeholder|change.?me|example\.com|your[-_])/i;
const trueValues = new Set(["1", "true", "yes", "on"]);

export function parseEnvFile(text) {
  const env = {};
  for (const [index, rawLine] of text.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u);
    if (!match) throw new Error(`invalid env syntax at line ${index + 1}`);
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    env[match[1]] = value;
  }
  return env;
}

export function validateProductionEnvironment(env) {
  const required = ["APP_DOMAIN", "BACKUP_DIR", "DEFAULT_TENANT_ID", "DEFAULT_COMPANY_ID", "DEFAULT_PROJECT_ID", "DEFAULT_PROJECT_SLUG", "PRODUCTION_APPROVAL_ISSUER", "PRODUCTION_APPROVAL_PUBLIC_KEYS_JSON", "POSTGRES_PASSWORD", "SANGFOR_APP_DB_PASSWORD", "SANGFOR_RUNTIME_DB_PASSWORD", "REDIS_PASSWORD", "API_KEY", "FINANCE_API_KEY", "SANGFOR_API_KEY", "SANGFOR_OPERATOR_PRINCIPAL_ID", "JWT_SECRET", "USER_JWT_ACTIVE_KID", "USER_JWT_KEYRING_JSON", "INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID", "INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON", "INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID", "INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON", "INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID", "INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON", "INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID", "INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON", "EXTERNAL_ACTION_RECEIPT_ACTIVE_KEY_ID", "EXTERNAL_ACTION_RECEIPT_KEYS_JSON"];
  const issues = [];
  for (const key of required) {
    const value = env[key]?.trim();
    if (!value) issues.push(`${key}: missing`);
    else if (placeholderPattern.test(value)) issues.push(`${key}: placeholder`);
  }
  if (env.APP_DOMAIN && (!/^[a-z0-9.-]+(?::[0-9]+)?$/iu.test(env.APP_DOMAIN) || env.APP_DOMAIN.includes(".."))) issues.push("APP_DOMAIN: expected hostname without scheme or path");
  if (env.BACKUP_DIR && !isAbsolute(env.BACKUP_DIR)) issues.push("BACKUP_DIR: must be absolute");
  for (const key of ["DEFAULT_TENANT_ID", "DEFAULT_COMPANY_ID", "DEFAULT_PROJECT_ID", "DEFAULT_PROJECT_SLUG", "PRODUCTION_APPROVAL_ISSUER"]) {
    if (env[key] && !/^[A-Za-z0-9._-]{3,128}$/u.test(env[key])) issues.push(`${key}: invalid identifier`);
  }
  for (const key of ["POSTGRES_PASSWORD", "SANGFOR_APP_DB_PASSWORD", "SANGFOR_RUNTIME_DB_PASSWORD", "REDIS_PASSWORD"]) {
    const value = env[key] ?? "";
    if (value && !/^[A-Za-z0-9_-]{32,}$/u.test(value)) issues.push(`${key}: must be at least 32 URL-safe characters`);
  }
  for (const key of ["API_KEY", "FINANCE_API_KEY", "SANGFOR_API_KEY", "JWT_SECRET"]) {
    if ((env[key]?.length ?? 0) < 24) issues.push(`${key}: must be at least 24 characters`);
  }
  if (env.AUTH_DEMO_PASSWORD?.trim()) issues.push("AUTH_DEMO_PASSWORD: forbidden in production");
  const uniquenessKeys = ["POSTGRES_PASSWORD", "SANGFOR_APP_DB_PASSWORD", "SANGFOR_RUNTIME_DB_PASSWORD", "REDIS_PASSWORD", "API_KEY", "FINANCE_API_KEY", "SANGFOR_API_KEY", "JWT_SECRET"];
  const seen = new Map();
  for (const key of uniquenessKeys) {
    const value = env[key];
    if (!value) continue;
    if (seen.has(value)) issues.push(`${key}: must differ from ${seen.get(value)}`);
    else seen.set(value, key);
  }
  for (const key of ["AUTH_BYPASS_ENABLED", "API_KEY_BYPASS_ENABLED", "MCP_AUTH_BYPASS_ENABLED"]) {
    if (trueValues.has((env[key] ?? "").trim().toLowerCase())) issues.push(`${key}: forbidden in production`);
  }
  if (env.AUTH_PROFILE === "local_mock") issues.push("AUTH_PROFILE=local_mock: forbidden in production");
  for (const [jsonKey, activeKidKey, expectedVersion, expectedProfile] of [
    ["USER_JWT_KEYRING_JSON", "USER_JWT_ACTIVE_KID", "sangfor.user-jwt-keyring/v1", undefined],
    ["INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON", "INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID", "sangfor.internal-principal-keyring/v1", "FINANCE"],
    ["INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON", "INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID", "sangfor.internal-principal-keyring/v1", "SCHEDULER"],
    ["INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON", "INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID", "sangfor.internal-principal-keyring/v1", "WORKFLOW"],
    ["INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON", "INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID", "sangfor.internal-principal-keyring/v1", "ENGINEER"],
  ]) {
    if (!env[jsonKey]) continue;
    try {
      const parsed = JSON.parse(env[jsonKey]);
      const active = parsed.keys?.find((key) => key.kid === env[activeKidKey] && key.state === "active");
      if (parsed.version !== expectedVersion) issues.push(`${jsonKey}: unexpected version`);
      if (expectedProfile && parsed.profile !== expectedProfile) issues.push(`${jsonKey}: unexpected profile`);
      const encodedSecret = active?.secretBase64Url;
      const secretBytes = typeof encodedSecret === "string" && /^[A-Za-z0-9_-]+$/u.test(encodedSecret)
        ? Buffer.from(encodedSecret, "base64url")
        : Buffer.alloc(0);
      if (!active || secretBytes.length < 32 || !Number.isFinite(Date.parse(active.activatedAt))) issues.push(`${jsonKey}: active key missing, malformed, or secret too short`);
      if (active && (active.demotedAt !== null || active.verifyUntil !== null || active.retiredAt !== null)) issues.push(`${jsonKey}: active key lifecycle fields must be null`);
      if (active && placeholderPattern.test(active.secretBase64Url)) issues.push(`${jsonKey}: placeholder secret`);
    } catch {
      issues.push(`${jsonKey}: invalid JSON`);
    }
  }
  if (env.EXTERNAL_ACTION_RECEIPT_KEYS_JSON) {
    try {
      const keys = JSON.parse(env.EXTERNAL_ACTION_RECEIPT_KEYS_JSON);
      const entry = keys?.[env.EXTERNAL_ACTION_RECEIPT_ACTIVE_KEY_ID];
      const secret = entry?.secret;
      if (!entry || Object.keys(entry).sort().join(",") !== "secret,signingDisabledAt,status" || entry.status !== "sign_verify" || entry.signingDisabledAt !== null || typeof secret !== "string" || !/^[A-Za-z0-9_-]+$/u.test(secret) || Buffer.from(secret, "base64url").length < 32 || placeholderPattern.test(secret)) issues.push("EXTERNAL_ACTION_RECEIPT_KEYS_JSON: active key missing, malformed, or placeholder");
    } catch {
      issues.push("EXTERNAL_ACTION_RECEIPT_KEYS_JSON: invalid JSON");
    }
  }
  if (env.PRODUCTION_APPROVAL_PUBLIC_KEYS_JSON) {
    try {
      const keys = JSON.parse(env.PRODUCTION_APPROVAL_PUBLIC_KEYS_JSON);
      const entries = Object.values(keys ?? {});
      if (entries.length === 0 || !entries.every((entry) => entry && Object.keys(entry).sort().join(",") === "publicKeyPem,status" && entry.status === "verify" && /^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\n?$/u.test(entry.publicKeyPem) && !placeholderPattern.test(entry.publicKeyPem))) issues.push("PRODUCTION_APPROVAL_PUBLIC_KEYS_JSON: trusted Ed25519 public key missing or malformed");
    } catch {
      issues.push("PRODUCTION_APPROVAL_PUBLIC_KEYS_JSON: invalid JSON");
    }
  }
  if (issues.length > 0) throw new Error(`production environment rejected:\n${issues.join("\n")}`);
  return { ok: true, requiredCount: required.length };
}

export function validateComposeModel(model) {
  const issues = [];
  const requiredServices = ["postgres", "redis", "backup", "migrate", "app-role-init", "api", "web", "caddy"];
  for (const service of requiredServices) if (!model.services?.[service]) issues.push(`missing service: ${service}`);
  for (const service of ["postgres", "redis", "api", "web"]) if (!model.services?.[service]?.healthcheck) issues.push(`missing healthcheck: ${service}`);
  for (const service of ["postgres", "redis", "api", "web"]) if ((model.services?.[service]?.ports?.length ?? 0) > 0) issues.push(`${service}: must not publish host ports`);
  if ((model.services?.caddy?.ports?.length ?? 0) !== 2) issues.push("caddy: expected HTTP and HTTPS ports");
  if (model.networks?.backend?.internal !== true) issues.push("backend network must remain internal");
  if (!model.services?.api?.environment?.DATABASE_URL?.includes("sangfor_runtime_login")) issues.push("api DATABASE_URL must use the non-DDL runtime role");
  if (!model.services?.web?.environment?.DATABASE_URL?.includes("sangfor_runtime_login")) issues.push("web DATABASE_URL must use the non-DDL runtime role");
  for (const service of ["api", "web"]) if (!model.services?.[service]?.environment?.DATABASE_URL?.includes("app.tenant_id")) issues.push(`${service}: runtime DATABASE_URL must pin RLS scope settings`);
  const roleInitCommand = JSON.stringify(model.services?.["app-role-init"]?.command ?? []);
  if (!roleInitCommand.includes("NOBYPASSRLS") || roleInitCommand.includes(" BYPASSRLS")) issues.push("runtime role must be NOBYPASSRLS");
  for (const service of ["api", "web"]) {
    if (model.services?.[service]?.environment?.AUTH_BYPASS_ENABLED !== "0" || model.services?.[service]?.environment?.API_KEY_BYPASS_ENABLED !== "0" || model.services?.[service]?.environment?.AUTH_PROFILE === "local_mock") issues.push(`${service}: unsafe runtime auth environment`);
  }
  if (model.services?.backup?.restart !== "no") issues.push("backup: restart must be no");
  if (model.services?.migrate?.restart !== "no") issues.push("migrate: restart must be no");
  if (model.services?.["app-role-init"]?.restart !== "no") issues.push("app-role-init: restart must be no");
  if (issues.length > 0) throw new Error(`production compose rejected:\n${issues.join("\n")}`);
  return { ok: true, serviceCount: Object.keys(model.services ?? {}).length };
}

function parseArgs(argv) {
  const index = argv.indexOf("--env-file");
  if (index < 0 || !argv[index + 1]) throw new Error("usage: verify-production-deploy.mjs --env-file <path>");
  return resolve(argv[index + 1]);
}

export function verifyProductionDeploy(envFile) {
  const mode = statSync(envFile).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error(`env file permissions must be owner-only (chmod 600): ${mode.toString(8)}`);
  const env = { ...parseEnvFile(readFileSync(envFile, "utf8")), ...process.env };
  const envResult = validateProductionEnvironment(env);
  const backupStat = statSync(env.BACKUP_DIR);
  if (!backupStat.isDirectory()) throw new Error("BACKUP_DIR must be an existing directory");
  if ((backupStat.mode & 0o077) !== 0) throw new Error("BACKUP_DIR permissions must be owner-only (chmod 700)");
  const compose = spawnSync("docker", ["compose", "--env-file", envFile, "-f", composeFile, "config", "--format", "json"], { cwd: root, encoding: "utf8", env });
  if (compose.status !== 0) throw new Error(`docker compose config failed (exit ${compose.status}): ${compose.stderr || "no stderr"}`);
  const composeResult = validateComposeModel(JSON.parse(compose.stdout));
  return { ...envResult, ...composeResult, envFile, appDomain: env.APP_DOMAIN, backupDir: env.BACKUP_DIR, apiImage: env.API_IMAGE || "sangfor-api", webImage: env.WEB_IMAGE || "sangfor-web" };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(verifyProductionDeploy(parseArgs(process.argv.slice(2))))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 64;
  }
}
