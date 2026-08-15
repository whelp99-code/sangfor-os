#!/usr/bin/env node
/**
 * cron-call.mjs — signs a session JWT, persists an AuthSession, and calls a
 * production endpoint through Caddy. Designed for launchd cron jobs that need
 * authenticated access to the production web stack.
 *
 * Usage:
 *   node scripts/launchd/cron-call.mjs --path /api/autopilot/run --method POST --body '{"limit":20}'
 *
 * Environment (read from the production web container):
 *   USER_JWT_KEYRING_JSON, USER_JWT_ACTIVE_KID, DEFAULT_TENANT_ID,
 *   DEFAULT_COMPANY_ID, DEFAULT_PROJECT_ID, SANGFOR_OPERATOR_PRINCIPAL_ID
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

import {
  parseSessionTtlSeconds,
  resolveCronCallConfig,
  shouldDisableTlsVerification,
} from "./cron-call-config.mjs";

// --- Config ---
const {
  webContainer: CONTAINER,
  postgresContainer: PG_CONTAINER,
  baseUrl: BASE_URL,
} = resolveCronCallConfig();
// Caddy uses a self-signed certificate only on the legacy loopback endpoint.
// Real production domains must retain normal certificate verification.
if (shouldDisableTlsVerification(BASE_URL)) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// --- Parse args ---
const args = process.argv.slice(2);
function arg(name) {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : null;
}
const path = arg("path");
const method = (arg("method") ?? "POST").toUpperCase();
const body = arg("body") ?? "{}";
if (!path) {
  console.error("usage: cron-call.mjs --path /api/... [--method POST] [--body '{...}']");
  process.exit(64);
}

// --- Read env from container ---
function containerEnv(name) {
  return execFileSync("docker", ["exec", CONTAINER, "printenv", name], { encoding: "utf8" }).trim();
}
const keyringJson = containerEnv("USER_JWT_KEYRING_JSON");
const activeKid = containerEnv("USER_JWT_ACTIVE_KID");
const tenantId = containerEnv("DEFAULT_TENANT_ID");
const companyId = containerEnv("DEFAULT_COMPANY_ID");
const projectId = containerEnv("DEFAULT_PROJECT_ID");
const TTL_SECONDS = parseSessionTtlSeconds(containerEnv("USER_JWT_TTL_SECONDS"));
// Resolve the actual DB user (not the service principal ID) from the DB.
const operatorId = execFileSync("docker", ["exec", PG_CONTAINER, "psql", "-U", "sangfor", "-d", "sangfor_os", "-Atc",
  `SELECT u.id FROM users u JOIN user_company_roles r ON r.user_id = u.id WHERE r.company_id = '${companyId}' AND r.status = 'active' AND u.status = 'active' LIMIT 1`],
  { encoding: "utf8" }).trim();
if (!operatorId) { console.error("no active operator user found in DB"); process.exit(69); }

// --- Extract HMAC secret from keyring ---
const keyring = JSON.parse(keyringJson);
const activeEntry = keyring.keys.find((k) => k.kid === activeKid && k.state === "active");
if (!activeEntry?.secretBase64Url) {
  console.error(`no active key ${activeKid} in keyring`);
  process.exit(69);
}
const secret = Buffer.from(activeEntry.secretBase64Url, "base64url");

// --- Sign JWT (HS256) ---
function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}
const now = Math.floor(Date.now() / 1000);
// One stable session row per cron identity: re-signing a fresh JWT every run is
// required (900s TTL), but minting a new AuthSession each time would leak a row
// per invocation. The upsert below just refreshes this row's expiry.
const jti = "cron-session-operator";
const header = { alg: "HS256", kid: activeKid, typ: "JWT" };
const claims = {
  iss: "sangfor-os",
  aud: "sangfor-os-runtime",
  ver: "sangfor.user-session/v1",
  sub: operatorId,
  jti,
  iat: now,
  exp: now + TTL_SECONDS,
  nbf: now,
  tenantId,
  companyId,
  projectId,
  projectSlug: projectId,
  role: "operator",
};
const signingInput = `${b64url(header)}.${b64url(claims)}`;
const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
const token = `${signingInput}.${signature}`;

// --- Upsert the single cron AuthSession, then drop any stale predecessors ---
const sql = `
INSERT INTO auth_sessions (id, user_id, tenant_id, company_id, project_id, issued_at, expires_at, created_at, updated_at)
VALUES ('${jti}', '${operatorId}', '${tenantId}', '${companyId}', '${projectId}', now(), now() + interval '${TTL_SECONDS} seconds', now(), now())
ON CONFLICT (id) DO UPDATE SET expires_at = now() + interval '${TTL_SECONDS} seconds', revoked_at = NULL, updated_at = now();
DELETE FROM auth_sessions WHERE id LIKE 'cron-%' AND id <> '${jti}';
`;
execFileSync("docker", ["exec", PG_CONTAINER, "psql", "-U", "sangfor", "-d", "sangfor_os", "-Atc", sql], { encoding: "utf8" });

// --- Call endpoint ---
const url = `${BASE_URL}${path}`;
const res = await fetch(url, {
  method,
  headers: {
    "Authorization": `Bearer ${token}`,
    // Route handlers read the session through `extractSessionToken`, which
    // accepts either header — but server-side helpers such as lib/cfo-client
    // read it via next/headers `cookies()`. Bearer alone made every Hometax
    // tax-invoice ingest inside mail-import fail 401 while the mail sync
    // itself succeeded, so send the same session both ways.
    "Cookie": `session=${token}`,
    "Content-Type": "application/json",
  },
  body: method !== "GET" ? body : undefined,
});
const text = await res.text();
if (!res.ok) {
  console.error(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  process.exit(22);
}
console.log(text.slice(0, 2000));

// A 2xx carrying `"success": false` is a real failure the operator has to see
// (e.g. Outlook is not connected). Exiting 0 there would park a permanent
// no-op behind a green `launchctl list` entry.
let payload;
try {
  payload = JSON.parse(text);
} catch {
  payload = null;
}
if (payload && payload.success === false) {
  console.error(`endpoint reported failure: ${payload.error ?? "unspecified"}`);
  process.exit(65);
}
