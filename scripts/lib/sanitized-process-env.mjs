/**
 * U007 — child process env sanitizer.
 * Starts from empty object; only exact parent pass-through allowlist.
 */
/** @type {readonly string[]} */
export const PARENT_PASSTHROUGH_KEYS = Object.freeze([
  "CI",
  "COREPACK_HOME",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "PATH",
  "PNPM_HOME",
  "PNPM_STORE_DIR",
  "SHELL",
  "TERM",
  "TMPDIR",
  "TZ",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
]);

/** Keys that must never be ambient-copied. */
const FORBIDDEN_AMBIENT_PREFIXES = ["NEXT_PUBLIC_", "TASK_", "ALIAS_"];
const FORBIDDEN_AMBIENT_EXACT = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
  "NODE_OPTIONS",
  "DATABASE_URL",
  "PORT",
  "API_PORT",
  "NODE_ENV",
  "NEXT_TELEMETRY_DISABLED",
]);

/**
 * @param {NodeJS.ProcessEnv} [parentEnv]
 * @returns {Record<string, string>}
 */
export function buildPassThroughEnv(parentEnv = process.env) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of PARENT_PASSTHROUGH_KEYS) {
    const v = parentEnv[key];
    if (v !== undefined && v !== null) {
      out[key] = String(v);
    }
  }
  return out;
}

/**
 * @param {{
 *   parentEnv?: NodeJS.ProcessEnv,
 *   explicit?: Record<string, string|undefined|null>,
 *   lane?: "install"|"build"|"runtime"|"playwright"|"generic",
 * }} [options]
 * @returns {Record<string, string>}
 */
export function makeSanitizedProcessEnv(options = {}) {
  const { parentEnv = process.env, explicit = {}, lane = "generic" } = options;
  const out = buildPassThroughEnv(parentEnv);

  // Install/build lane exact additions only
  if (lane === "install" || lane === "build") {
    out.NODE_ENV = "production";
    out.NEXT_TELEMETRY_DISABLED = "1";
  }

  for (const [key, value] of Object.entries(explicit)) {
    if (value === undefined || value === null) {
      throw Object.assign(new Error(`sanitized-env: empty explicit value for ${key}`), {
        exitCode: 64,
      });
    }
    if (key === "") {
      throw Object.assign(new Error("sanitized-env: empty key"), { exitCode: 64 });
    }
    if (Object.prototype.hasOwnProperty.call(out, key) && out[key] !== String(value)) {
      // duplicate provenance with conflict
      throw Object.assign(
        new Error(`sanitized-env: duplicate provenance conflict for ${key}`),
        { exitCode: 64 },
      );
    }
    out[key] = String(value);
  }

  // Safety: never leave forbidden ambient keys that snuck in
  for (const key of Object.keys(out)) {
    if (FORBIDDEN_AMBIENT_EXACT.has(key) && !Object.prototype.hasOwnProperty.call(explicit, key)) {
      if (lane === "install" || lane === "build") {
        if (key === "NODE_ENV" || key === "NEXT_TELEMETRY_DISABLED") continue;
      }
      delete out[key];
    }
    for (const prefix of FORBIDDEN_AMBIENT_PREFIXES) {
      if (key.startsWith(prefix) && !Object.prototype.hasOwnProperty.call(explicit, key)) {
        delete out[key];
      }
    }
  }

  return out;
}

/**
 * Probe helper for hostile parent env fixtures.
 * @param {NodeJS.ProcessEnv} parentEnv
 * @returns {string[]} ambient forbidden keys present in sanitized result (should be empty)
 */
export function ambientForbiddenKeysInChild(parentEnv) {
  const child = makeSanitizedProcessEnv({ parentEnv, lane: "generic" });
  const hits = [];
  for (const key of Object.keys(child)) {
    if (FORBIDDEN_AMBIENT_EXACT.has(key)) hits.push(key);
    for (const prefix of FORBIDDEN_AMBIENT_PREFIXES) {
      if (key.startsWith(prefix)) hits.push(key);
    }
    if (key === "DATABASE_URL" || key === "NODE_OPTIONS") hits.push(key);
  }
  return [...new Set(hits)];
}

/**
 * @param {Record<string, string>} env
 * @returns {string[]}
 */
export function envKeySet(env) {
  return Object.keys(env).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
