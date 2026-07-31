#!/usr/bin/env node
/**
 * reconstruct-production-env.mjs — rebuild .env.production from the running
 * production stack.
 *
 * The env file a deployment was launched with is not retained: `.local-prod`
 * is scratch and gets reclaimed. Once it is gone the stack keeps running but
 * cannot be redeployed or even recreated, because every secret lives only in
 * the containers' own environment. This reads those back and re-emits the file
 * `scripts/deploy-production.sh` expects.
 *
 * Usage:
 *   node scripts/reconstruct-production-env.mjs            # write .env.production
 *   node scripts/reconstruct-production-env.mjs --stdout   # print instead (no secrets to disk)
 *   node scripts/reconstruct-production-env.mjs --out path
 *
 * Values are read from the live containers; nothing is invented. Any variable
 * that cannot be recovered is reported and left for the operator to supply.
 */
import { execFileSync } from "node:child_process";
import { writeFileSync, chmodSync } from "node:fs";

const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? "sangfor-production";
const WEB = `${PROJECT}-web-1`;
const API = `${PROJECT}-api-1`;
const PG = `${PROJECT}-postgres-1`;
const CADDY = `${PROJECT}-caddy-1`;

const args = process.argv.slice(2);
const toStdout = args.includes("--stdout");
const outIdx = args.indexOf("--out");
const outPath = outIdx !== -1 ? args[outIdx + 1] : ".env.production";

function sh(bin, argv) {
  return execFileSync(bin, argv, { encoding: "utf8" }).trim();
}
function containerEnv(container) {
  const raw = sh("docker", ["exec", container, "printenv"]);
  const map = new Map();
  for (const line of raw.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) map.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return map;
}
function query(sql) {
  return sh("docker", ["exec", PG, "psql", "-U", "sangfor", "-d", "sangfor_os", "-Atc", sql]);
}
/** Pulls the password out of a `scheme://user:password@host` URL. */
function passwordFrom(url) {
  const m = /^[a-z+]+:\/\/[^:/@]*:([^@]*)@/.exec(url ?? "");
  return m ? decodeURIComponent(m[1]) : null;
}

const web = containerEnv(WEB);
const caddy = containerEnv(CADDY);
const pg = containerEnv(PG);

// Ports Caddy actually publishes, rather than assuming the compose defaults.
const portJson = JSON.parse(sh("docker", ["inspect", CADDY, "--format", "{{json .NetworkSettings.Ports}}"]));
const hostPort = (containerPort) => portJson?.[containerPort]?.[0]?.HostPort ?? null;

const recovered = {
  COMPOSE_PROJECT_NAME: PROJECT,
  APP_DOMAIN: caddy.get("APP_DOMAIN"),
  HTTP_PORT: hostPort("80/tcp"),
  HTTPS_PORT: hostPort("443/tcp"),

  API_IMAGE_REF: sh("docker", ["inspect", API, "--format", "{{.Config.Image}}"]),
  WEB_IMAGE_REF: sh("docker", ["inspect", WEB, "--format", "{{.Config.Image}}"]),

  POSTGRES_DB: pg.get("POSTGRES_DB") ?? web.get("POSTGRES_DB"),
  POSTGRES_PASSWORD: pg.get("POSTGRES_PASSWORD"),
  SANGFOR_RUNTIME_DB_PASSWORD: passwordFrom(web.get("DATABASE_URL")),
  SANGFOR_APP_DB_PASSWORD: passwordFrom(web.get("SANGFOR_APP_DATABASE_URL")),
  REDIS_PASSWORD: passwordFrom(web.get("REDIS_URL")),

  DEFAULT_TENANT_ID: web.get("DEFAULT_TENANT_ID"),
  DEFAULT_COMPANY_ID: web.get("DEFAULT_COMPANY_ID"),
  DEFAULT_PROJECT_ID: web.get("DEFAULT_PROJECT_ID"),
  DEFAULT_PROJECT_SLUG: web.get("DEFAULT_PROJECT_SLUG"),
  DEFAULT_TENANT_SLUG: query(`SELECT slug FROM tenants WHERE id = '${web.get("DEFAULT_TENANT_ID")}'`),
  DEFAULT_COMPANY_SLUG: query(`SELECT slug FROM companies WHERE id = '${web.get("DEFAULT_COMPANY_ID")}'`),

  PRODUCTION_OPERATOR_USER_ID: query("SELECT id FROM users WHERE status = 'active' ORDER BY created_at LIMIT 1"),
  PRODUCTION_OPERATOR_EMAIL: query("SELECT email FROM users WHERE status = 'active' ORDER BY created_at LIMIT 1"),
  PRODUCTION_OPERATOR_ROLE: query("SELECT role FROM user_company_roles WHERE status = 'active' ORDER BY valid_from LIMIT 1"),
};

// Straight passthroughs: same name in the container, same name in the file.
for (const key of [
  "API_KEY", "FINANCE_API_KEY", "SANGFOR_API_KEY", "SANGFOR_OPERATOR_PRINCIPAL_ID",
  "JWT_SECRET",
  "USER_JWT_ACTIVE_KID", "USER_JWT_KEYRING_JSON", "USER_JWT_ISSUER", "USER_JWT_AUDIENCE",
  "USER_JWT_TTL_SECONDS", "USER_JWT_CLOCK_SKEW_SECONDS", "USER_JWT_ROTATION_OWNER",
  "INTERNAL_PRINCIPAL_TTL_SECONDS", "INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS", "INTERNAL_PRINCIPAL_ROTATION_OWNER",
  "INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID", "INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON",
  "INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID", "INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON",
  "INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID", "INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON",
  "INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID", "INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON",
  "EXTERNAL_ACTION_RECEIPT_ACTIVE_KEY_ID", "EXTERNAL_ACTION_RECEIPT_KEYS_JSON",
  "OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_TENANT_ID", "OUTLOOK_REDIRECT_URI",
]) {
  const value = web.get(key);
  if (value !== undefined) recovered[key] = value;
}

// BACKUP_DIR is a host path, so it is not in any running container's env. The
// one-shot `backup` service still holds it as a bind-mount source, and that
// container is `restart: no` — it lingers in `Exited` state after a deploy.
function backupDirFromBackupService() {
  try {
    const source = sh("docker", [
      "inspect", `${PROJECT}-backup-1`,
      "--format", '{{range .Mounts}}{{if eq .Destination "/backups"}}{{.Source}}{{end}}{{end}}',
    ]);
    return source || "";
  } catch {
    return "";
  }
}
recovered.BACKUP_DIR ??= backupDirFromBackupService();

// Outlook is optional: the stack deploys and runs without it, only the
// mail-import cron stays inert. Emit the keys anyway so the operator can see
// where the Entra credentials belong instead of hunting for the names.
const OPTIONAL = new Set(["OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET", "OUTLOOK_TENANT_ID", "OUTLOOK_REDIRECT_URI"]);
for (const key of OPTIONAL) recovered[key] ??= "";

const missing = Object.entries(recovered)
  .filter(([k, v]) => !OPTIONAL.has(k) && (v === null || v === undefined || v === ""))
  .map(([k]) => k);

/**
 * Both consumers of this file (scripts/verify-production-deploy.mjs and
 * `docker compose --env-file`) strip one layer of surrounding quotes literally
 * — neither processes backslash escapes. JSON.stringify would therefore write
 * an escaped payload that parses back as literal `\"` and breaks every keyring.
 * Single quotes keep JSON, spaces and `#` intact verbatim.
 */
function quoteEnvValue(value) {
  const text = String(value);
  if (text.includes("\n")) throw new Error("env values cannot contain newlines");
  return text.includes("'") ? text : `'${text}'`;
}

const body = [
  "# Reconstructed from the running production stack by",
  "# scripts/reconstruct-production-env.mjs — values were read back from the",
  "# live containers, not regenerated. Keep this file out of version control.",
  `# Generated: ${new Date().toISOString()}`,
  "",
  ...Object.entries(recovered).map(([k, v]) => `${k}=${quoteEnvValue(v ?? "")}`),
  "",
].join("\n");

if (toStdout) {
  process.stdout.write(body);
} else {
  writeFileSync(outPath, body, { mode: 0o600 });
  chmodSync(outPath, 0o600);
  process.stderr.write(`wrote ${outPath} (mode 600, ${Object.keys(recovered).length} vars)\n`);
}

if (missing.length > 0) {
  process.stderr.write(`operator must supply: ${missing.join(", ")}\n`);
  process.exit(65);
}
