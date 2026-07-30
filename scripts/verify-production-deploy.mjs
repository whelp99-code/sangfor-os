import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const composeFile = resolve(root, "docker-compose.production.yml");
const userJwtParser = new URL("../packages/config/src/user-jwt.ts", import.meta.url).href;
const internalPrincipalParser = new URL("../packages/config/src/internal-principal.ts", import.meta.url).href;
const placeholderPattern = /(replace|placeholder|change.?me|example\.com|your[-_])/i;
const trueValues = new Set(["1", "true", "yes", "on"]);
const reservedEmailDomainPattern = /(?:^|\.)invalid$|(?:^|\.)test$|(?:^|\.)example$|(?:^|\.)localhost$/u;

const canonicalKeyringValidationProgram = `
import { parseUserJwtConfig } from ${JSON.stringify(userJwtParser)};
import { parseInternalPrincipalConfig } from ${JSON.stringify(internalPrincipalParser)};
let input = "";
for await (const chunk of process.stdin) input += chunk;
try {
  const env = JSON.parse(input);
  parseUserJwtConfig(env);
  parseInternalPrincipalConfig(env);
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\\n");
  process.exitCode = 64;
}
`;

function validateCanonicalRuntimeKeyrings(env, issues) {
  const effectiveRuntimeEnv = {
    ...env,
    USER_JWT_ROTATION_OWNER: "security-auth",
    USER_JWT_ISSUER: env.USER_JWT_ISSUER || "sangfor-os",
    USER_JWT_AUDIENCE: env.USER_JWT_AUDIENCE || "sangfor-os-runtime",
    USER_JWT_TTL_SECONDS: env.USER_JWT_TTL_SECONDS || "900",
    USER_JWT_CLOCK_SKEW_SECONDS: env.USER_JWT_CLOCK_SKEW_SECONDS || "30",
    INTERNAL_PRINCIPAL_TTL_SECONDS: env.INTERNAL_PRINCIPAL_TTL_SECONDS || "60",
    INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS: env.INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS || "5",
    INTERNAL_PRINCIPAL_ROTATION_OWNER: "security-auth",
  };
  const validation = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", canonicalKeyringValidationProgram], {
    cwd: root,
    encoding: "utf8",
    input: JSON.stringify(effectiveRuntimeEnv),
  });
  if (validation.error) {
    issues.push(`runtime keyring canonical validation unavailable: ${validation.error.message}`);
  } else if (validation.status !== 0) {
    issues.push(`runtime keyring configuration invalid: ${validation.stderr.trim() || `canonical parser exited ${validation.status}`}`);
  }
}

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
  const required = ["APP_DOMAIN", "BACKUP_DIR", "DEFAULT_TENANT_ID", "DEFAULT_TENANT_SLUG", "DEFAULT_COMPANY_ID", "DEFAULT_COMPANY_SLUG", "DEFAULT_PROJECT_ID", "DEFAULT_PROJECT_SLUG", "PRODUCTION_OPERATOR_USER_ID", "PRODUCTION_OPERATOR_EMAIL", "POSTGRES_PASSWORD", "SANGFOR_APP_DB_PASSWORD", "SANGFOR_RUNTIME_DB_PASSWORD", "REDIS_PASSWORD", "API_KEY", "FINANCE_API_KEY", "SANGFOR_API_KEY", "SANGFOR_OPERATOR_PRINCIPAL_ID", "JWT_SECRET", "USER_JWT_ACTIVE_KID", "USER_JWT_KEYRING_JSON", "INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID", "INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON", "INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID", "INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON", "INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID", "INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON", "INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID", "INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON", "EXTERNAL_ACTION_RECEIPT_ACTIVE_KEY_ID", "EXTERNAL_ACTION_RECEIPT_KEYS_JSON"];
  const issues = [];
  for (const key of required) {
    const value = env[key]?.trim();
    if (!value) issues.push(`${key}: missing`);
    else if (placeholderPattern.test(value)) issues.push(`${key}: placeholder`);
  }
  if (env.APP_DOMAIN && (!/^[a-z0-9.-]+(?::[0-9]+)?$/iu.test(env.APP_DOMAIN) || env.APP_DOMAIN.includes(".."))) issues.push("APP_DOMAIN: expected hostname without scheme or path");
  if (env.BACKUP_DIR && !isAbsolute(env.BACKUP_DIR)) issues.push("BACKUP_DIR: must be absolute");
  for (const key of ["DEFAULT_TENANT_ID", "DEFAULT_TENANT_SLUG", "DEFAULT_COMPANY_ID", "DEFAULT_COMPANY_SLUG", "DEFAULT_PROJECT_ID", "DEFAULT_PROJECT_SLUG", "PRODUCTION_OPERATOR_USER_ID"]) {
    if (env[key] && !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/u.test(env[key])) issues.push(`${key}: invalid identifier`);
  }
  if (env.PRODUCTION_OPERATOR_EMAIL && (env.PRODUCTION_OPERATOR_EMAIL !== env.PRODUCTION_OPERATOR_EMAIL.toLowerCase() || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u.test(env.PRODUCTION_OPERATOR_EMAIL))) issues.push("PRODUCTION_OPERATOR_EMAIL: expected canonical lowercase email");
  else if (env.PRODUCTION_OPERATOR_EMAIL && reservedEmailDomainPattern.test(env.PRODUCTION_OPERATOR_EMAIL.slice(env.PRODUCTION_OPERATOR_EMAIL.lastIndexOf("@") + 1))) issues.push("PRODUCTION_OPERATOR_EMAIL: reserved email domain");
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
  validateCanonicalRuntimeKeyrings(env, issues);
  for (const jsonKey of ["USER_JWT_KEYRING_JSON", "INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON", "INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON", "INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON", "INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON"]) {
    if (!env[jsonKey]) continue;
    try {
      const parsed = JSON.parse(env[jsonKey]);
      if (parsed.keys?.some((key) => typeof key.secretBase64Url === "string" && placeholderPattern.test(key.secretBase64Url))) issues.push(`${jsonKey}: placeholder secret`);
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
  if (issues.length > 0) throw new Error(`production environment rejected:\n${issues.join("\n")}`);
  return { ok: true, requiredCount: required.length };
}

export function validateComposeModel(model) {
  const issues = [];
  const requiredServices = ["postgres", "redis", "backup", "migrate", "bootstrap", "app-role-init", "api", "web", "caddy"];
  for (const service of requiredServices) if (!model.services?.[service]) issues.push(`missing service: ${service}`);
  for (const service of ["postgres", "redis", "api", "web"]) if (!model.services?.[service]?.healthcheck) issues.push(`missing healthcheck: ${service}`);
  for (const service of ["postgres", "redis", "api", "web"]) if ((model.services?.[service]?.ports?.length ?? 0) > 0) issues.push(`${service}: must not publish host ports`);
  if ((model.services?.caddy?.ports?.length ?? 0) !== 2) issues.push("caddy: expected HTTP and HTTPS ports");
  if (model.networks?.backend?.internal !== true) issues.push("backend network must remain internal");
  if (!model.services?.api?.environment?.DATABASE_URL?.includes("sangfor_runtime_login")) issues.push("api DATABASE_URL must use the non-DDL runtime role");
  if (!model.services?.web?.environment?.DATABASE_URL?.includes("sangfor_runtime_login")) issues.push("web DATABASE_URL must use the non-DDL runtime role");
  for (const service of ["api", "web"]) if (!model.services?.[service]?.environment?.DATABASE_URL?.includes("app.tenant_id")) issues.push(`${service}: runtime DATABASE_URL must pin RLS scope settings`);
  for (const service of ["api", "web"]) if (model.services?.[service]?.environment?.SANGFOR_PROCESS_PROFILE !== "production") issues.push(`${service}: SANGFOR_PROCESS_PROFILE must be production`);
  for (const service of ["api", "web"]) if ((model.services?.[service]?.volumes?.length ?? 0) > 0) issues.push(`${service}: runtime source bind mounts are forbidden`);
  const roleInitCommand = JSON.stringify(model.services?.["app-role-init"]?.command ?? []);
  if (!roleInitCommand.includes("NOBYPASSRLS") || roleInitCommand.includes(" BYPASSRLS")) issues.push("runtime role must be NOBYPASSRLS");
  const bootstrap = model.services?.bootstrap;
  const bootstrapDatabaseUrl = bootstrap?.environment?.DATABASE_URL;
  if (typeof bootstrapDatabaseUrl !== "string" || !bootstrapDatabaseUrl.startsWith("postgresql://sangfor:")) issues.push("bootstrap: DATABASE_URL must use the admin database role");
  const bootstrapEnvironmentKeys = Object.keys(bootstrap?.environment ?? {}).sort();
  const expectedBootstrapEnvironmentKeys = ["DATABASE_URL", "DEFAULT_COMPANY_ID", "DEFAULT_COMPANY_SLUG", "DEFAULT_PROJECT_ID", "DEFAULT_PROJECT_SLUG", "DEFAULT_TENANT_ID", "DEFAULT_TENANT_SLUG", "PRODUCTION_OPERATOR_EMAIL", "PRODUCTION_OPERATOR_ROLE", "PRODUCTION_OPERATOR_USER_ID"].sort();
  if (bootstrapEnvironmentKeys.join(",") !== expectedBootstrapEnvironmentKeys.join(",")) issues.push("bootstrap: environment must contain only the admin URL and bootstrap identities");
  const expectedBootstrapCommand = ["node", "--import", "tsx", "/app/scripts/provision-production-bootstrap.mjs"];
  const bootstrapCommand = bootstrap?.command;
  if (!Array.isArray(bootstrapCommand) || bootstrapCommand.length !== expectedBootstrapCommand.length || bootstrapCommand.some((argument, index) => argument !== expectedBootstrapCommand[index])) {
    issues.push("bootstrap: command must exactly be node --import tsx /app/scripts/provision-production-bootstrap.mjs");
  }
  const bootstrapVolumes = bootstrap?.volumes ?? [];
  if (bootstrapVolumes.length !== 1 || bootstrapVolumes[0]?.type !== "bind" || bootstrapVolumes[0]?.target !== "/app/scripts/provision-production-bootstrap.mjs" || bootstrapVolumes[0]?.read_only !== true) issues.push("bootstrap: must mount only the read-only provisioner script");
  if (Object.keys(bootstrap?.depends_on ?? {}).join(",") !== "migrate" || bootstrap?.depends_on?.migrate?.condition !== "service_completed_successfully") issues.push("bootstrap: must wait only for migrate completion");
  const roleInitDependencies = model.services?.["app-role-init"]?.depends_on ?? {};
  if (Object.keys(roleInitDependencies).join(",") !== "bootstrap" || roleInitDependencies.bootstrap?.condition !== "service_completed_successfully") issues.push("app-role-init: must wait only for bootstrap completion");
  for (const service of ["api", "web"]) {
    if (model.services?.[service]?.environment?.AUTH_BYPASS_ENABLED !== "0" || model.services?.[service]?.environment?.API_KEY_BYPASS_ENABLED !== "0" || model.services?.[service]?.environment?.AUTH_PROFILE === "local_mock") issues.push(`${service}: unsafe runtime auth environment`);
  }
  if (model.services?.backup?.restart !== "no") issues.push("backup: restart must be no");
  if (model.services?.migrate?.restart !== "no") issues.push("migrate: restart must be no");
  if (bootstrap?.restart !== "no") issues.push("bootstrap: restart must be no");
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
