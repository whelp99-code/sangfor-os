/**
 * @sangfor/config - User session JWT contract boundary (U013 / SEC-01)
 *
 * The single typed boundary for the unified HS256 session-JWT contract shared
 * by web (cookie + Proxy) and the API (bearer). Only this module may read the
 * `USER_JWT_*` environment names; every other package/app must import the
 * parsed result from here instead of touching `process.env` directly.
 *
 * Security posture: fail closed. Any structural, business-rule, or timestamp
 * violation in the keyring throws `UserJwtConfigError` — callers must treat
 * that as "session auth unavailable", never as an implicit open/mock mode.
 */
import { z } from 'zod';

/** Fixed contract constants — byte-matched against the declarative env vars below. */
export const SANGFOR_JWT_ISSUER = 'sangfor-os' as const;
export const SANGFOR_JWT_AUDIENCE = 'sangfor-os-runtime' as const;
export const SANGFOR_JWT_ALGORITHM = 'HS256' as const;
export const SANGFOR_JWT_TYPE = 'JWT' as const;
export const SANGFOR_JWT_CLAIMS_VERSION = 'sangfor.user-session/v1' as const;
export const SANGFOR_JWT_TTL_SECONDS = 900 as const;
export const SANGFOR_JWT_CLOCK_SKEW_SECONDS = 30 as const;

/** Old-key verify window: TTL + skew, per the rotation contract (D+930). */
const VERIFY_ONLY_WINDOW_SECONDS = SANGFOR_JWT_TTL_SECONDS + SANGFOR_JWT_CLOCK_SKEW_SECONDS;

export const USER_JWT_ROTATION_OWNER_EXPECTED = 'security-auth' as const;
export const USER_JWT_KEYRING_VERSION = 'sangfor.user-jwt-keyring/v1' as const;

export const KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RFC3339_SECONDS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export type UserJwtKeyState = 'active' | 'verify_only' | 'retired';

export interface UserJwtKeyringEntry {
  readonly kid: string;
  readonly state: UserJwtKeyState;
  readonly secretBase64Url: string | null;
  readonly activatedAt: string;
  readonly demotedAt: string | null;
  readonly verifyUntil: string | null;
  readonly retiredAt: string | null;
}

export interface UserJwtKeyring {
  readonly version: typeof USER_JWT_KEYRING_VERSION;
  readonly keys: readonly UserJwtKeyringEntry[];
}

export interface UserJwtActiveKey {
  readonly kid: string;
  readonly secret: Buffer;
  readonly activatedAtSeconds: number;
}

export interface UserJwtVerifyOnlyKey {
  readonly kid: string;
  readonly secret: Buffer;
  readonly activatedAtSeconds: number;
  readonly demotedAtSeconds: number;
  readonly verifyUntilSeconds: number;
}

export interface UserJwtConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly algorithm: typeof SANGFOR_JWT_ALGORITHM;
  readonly claimsVersion: typeof SANGFOR_JWT_CLAIMS_VERSION;
  readonly ttlSeconds: number;
  readonly clockSkewSeconds: number;
  readonly rotationOwner: string;
  readonly activeKid: string;
  readonly active: UserJwtActiveKey;
  readonly verifyOnly: ReadonlyMap<string, UserJwtVerifyOnlyKey>;
  readonly retiredKids: ReadonlySet<string>;
}

export class UserJwtConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserJwtConfigError';
  }
}

function fail(message: string): never {
  throw new UserJwtConfigError(`USER_JWT config: ${message}`);
}

const KeyringEntrySchema = z
  .object({
    kid: z.string(),
    state: z.enum(['active', 'verify_only', 'retired']),
    secretBase64Url: z.string().nullable(),
    activatedAt: z.string(),
    demotedAt: z.string().nullable(),
    verifyUntil: z.string().nullable(),
    retiredAt: z.string().nullable(),
  })
  .strict();

const KeyringSchema = z
  .object({
    version: z.literal(USER_JWT_KEYRING_VERSION),
    keys: z.array(KeyringEntrySchema),
  })
  .strict();

function parseRfc3339Seconds(value: string, field: string): number {
  if (!RFC3339_SECONDS_PATTERN.test(value)) {
    fail(`${field} must be a UTC RFC3339-seconds timestamp (YYYY-MM-DDThh:mm:ssZ), got ${JSON.stringify(value)}`);
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) fail(`${field} is not a valid timestamp: ${JSON.stringify(value)}`);
  return Math.floor(ms / 1000);
}

function decodeSecret(value: string, field: string): Buffer {
  if (value.length === 0 || !BASE64URL_PATTERN.test(value)) {
    fail(`${field} must be non-empty unpadded base64url`);
  }
  let buf: Buffer;
  try {
    buf = Buffer.from(value, 'base64url');
  } catch {
    fail(`${field} is not valid base64url`);
  }
  // Canonical round-trip: rejects non-minimal / stray-bit encodings.
  if (buf!.toString('base64url') !== value) {
    fail(`${field} is not canonical unpadded base64url`);
  }
  if (buf!.length < 32 || buf!.length > 64) {
    fail(`${field} must decode to 32-64 bytes (got ${buf!.length})`);
  }
  return buf!;
}

export interface ParseUserJwtConfigEnv {
  readonly USER_JWT_ACTIVE_KID?: string;
  readonly USER_JWT_KEYRING_JSON?: string;
  readonly USER_JWT_ROTATION_OWNER?: string;
  readonly USER_JWT_ISSUER?: string;
  readonly USER_JWT_AUDIENCE?: string;
  readonly USER_JWT_TTL_SECONDS?: string;
  readonly USER_JWT_CLOCK_SKEW_SECONDS?: string;
}

/**
 * Parse and validate the full `USER_JWT_*` boundary. Pure function of its
 * inputs — no caching — so callers always see the current environment and
 * rotation state. Throws `UserJwtConfigError` (never returns a partial or
 * silently-defaulted config) on any structural or business-rule violation.
 */
export function parseUserJwtConfig(
  env: ParseUserJwtConfigEnv,
  now: number = Math.floor(Date.now() / 1000),
): UserJwtConfig {
  const activeKidEnv = env.USER_JWT_ACTIVE_KID?.trim();
  if (!activeKidEnv) fail('USER_JWT_ACTIVE_KID is required');
  if (!KID_PATTERN.test(activeKidEnv)) fail('USER_JWT_ACTIVE_KID does not match the kid pattern');

  const rotationOwner = env.USER_JWT_ROTATION_OWNER?.trim() ?? '';
  if (rotationOwner !== USER_JWT_ROTATION_OWNER_EXPECTED) {
    fail(`USER_JWT_ROTATION_OWNER must equal "${USER_JWT_ROTATION_OWNER_EXPECTED}"`);
  }

  const issuer = env.USER_JWT_ISSUER?.trim() ?? '';
  if (issuer !== SANGFOR_JWT_ISSUER) fail(`USER_JWT_ISSUER must byte-match "${SANGFOR_JWT_ISSUER}"`);

  const audience = env.USER_JWT_AUDIENCE?.trim() ?? '';
  if (audience !== SANGFOR_JWT_AUDIENCE) fail(`USER_JWT_AUDIENCE must byte-match "${SANGFOR_JWT_AUDIENCE}"`);

  const ttlRaw = env.USER_JWT_TTL_SECONDS?.trim() ?? '';
  if (ttlRaw !== String(SANGFOR_JWT_TTL_SECONDS)) {
    fail(`USER_JWT_TTL_SECONDS must byte-match "${SANGFOR_JWT_TTL_SECONDS}"`);
  }

  const skewRaw = env.USER_JWT_CLOCK_SKEW_SECONDS?.trim() ?? '';
  if (skewRaw !== String(SANGFOR_JWT_CLOCK_SKEW_SECONDS)) {
    fail(`USER_JWT_CLOCK_SKEW_SECONDS must byte-match "${SANGFOR_JWT_CLOCK_SKEW_SECONDS}"`);
  }

  const keyringRaw = env.USER_JWT_KEYRING_JSON;
  if (!keyringRaw || keyringRaw.trim().length === 0) fail('USER_JWT_KEYRING_JSON is required');

  let keyringJson: unknown;
  try {
    keyringJson = JSON.parse(keyringRaw);
  } catch {
    fail('USER_JWT_KEYRING_JSON is not valid JSON');
  }

  const keyringResult = KeyringSchema.safeParse(keyringJson);
  if (!keyringResult.success) {
    fail(`USER_JWT_KEYRING_JSON has an invalid shape: ${keyringResult.error.issues.map((i) => i.message).join('; ')}`);
  }
  const keyring = keyringResult.data;

  const seenKids = new Set<string>();
  let active: UserJwtActiveKey | null = null;
  const verifyOnly = new Map<string, UserJwtVerifyOnlyKey>();
  const retiredKids = new Set<string>();

  for (const entry of keyring.keys) {
    if (!KID_PATTERN.test(entry.kid)) fail(`key ${JSON.stringify(entry.kid)} does not match the kid pattern`);
    if (seenKids.has(entry.kid)) fail(`duplicate kid ${JSON.stringify(entry.kid)}`);
    seenKids.add(entry.kid);

    const activatedAtSeconds = parseRfc3339Seconds(entry.activatedAt, `keys[kid=${entry.kid}].activatedAt`);

    if (entry.state === 'active') {
      if (entry.demotedAt !== null) fail(`active key ${entry.kid}: demotedAt must be null`);
      if (entry.verifyUntil !== null) fail(`active key ${entry.kid}: verifyUntil must be null`);
      if (entry.retiredAt !== null) fail(`active key ${entry.kid}: retiredAt must be null`);
      if (entry.secretBase64Url === null) fail(`active key ${entry.kid}: secretBase64Url is required`);
      const secret = decodeSecret(entry.secretBase64Url, `keys[kid=${entry.kid}].secretBase64Url`);
      if (active !== null) fail('multiple active keys present (exactly one required)');
      active = { kid: entry.kid, secret, activatedAtSeconds };
      continue;
    }

    if (entry.state === 'verify_only') {
      if (entry.retiredAt !== null) fail(`verify_only key ${entry.kid}: retiredAt must be null`);
      if (entry.secretBase64Url === null) fail(`verify_only key ${entry.kid}: secretBase64Url is required`);
      if (entry.demotedAt === null) fail(`verify_only key ${entry.kid}: demotedAt is required`);
      if (entry.verifyUntil === null) fail(`verify_only key ${entry.kid}: verifyUntil is required`);
      const secret = decodeSecret(entry.secretBase64Url, `keys[kid=${entry.kid}].secretBase64Url`);
      const demotedAtSeconds = parseRfc3339Seconds(entry.demotedAt, `keys[kid=${entry.kid}].demotedAt`);
      const verifyUntilSeconds = parseRfc3339Seconds(entry.verifyUntil, `keys[kid=${entry.kid}].verifyUntil`);
      if (!(activatedAtSeconds < demotedAtSeconds)) {
        fail(`verify_only key ${entry.kid}: activatedAt must be < demotedAt`);
      }
      if (verifyUntilSeconds !== demotedAtSeconds + VERIFY_ONLY_WINDOW_SECONDS) {
        fail(`verify_only key ${entry.kid}: verifyUntil must equal demotedAt + ${VERIFY_ONLY_WINDOW_SECONDS}`);
      }
      if (now > verifyUntilSeconds) {
        fail(`verify_only key ${entry.kid}: overdue (verifyUntil has passed) — must be retired`);
      }
      verifyOnly.set(entry.kid, { kid: entry.kid, secret, activatedAtSeconds, demotedAtSeconds, verifyUntilSeconds });
      continue;
    }

    // retired
    if (entry.secretBase64Url !== null) fail(`retired key ${entry.kid}: secretBase64Url must be null`);
    if (entry.demotedAt === null) fail(`retired key ${entry.kid}: demotedAt is required`);
    if (entry.retiredAt === null) fail(`retired key ${entry.kid}: retiredAt is required`);
    if (entry.verifyUntil === null) fail(`retired key ${entry.kid}: verifyUntil is required`);
    const demotedAtSeconds = parseRfc3339Seconds(entry.demotedAt, `keys[kid=${entry.kid}].demotedAt`);
    const retiredAtSeconds = parseRfc3339Seconds(entry.retiredAt, `keys[kid=${entry.kid}].retiredAt`);
    const verifyUntilSeconds = parseRfc3339Seconds(entry.verifyUntil, `keys[kid=${entry.kid}].verifyUntil`);
    if (!(demotedAtSeconds <= retiredAtSeconds && retiredAtSeconds <= verifyUntilSeconds)) {
      fail(`retired key ${entry.kid}: requires demotedAt <= retiredAt <= verifyUntil`);
    }
    retiredKids.add(entry.kid);
  }

  if (!active) fail('exactly one active key is required (found none)');
  if (active.kid !== activeKidEnv) {
    fail(`USER_JWT_ACTIVE_KID (${activeKidEnv}) does not match the keyring's active kid (${active.kid})`);
  }

  return {
    issuer,
    audience,
    algorithm: SANGFOR_JWT_ALGORITHM,
    claimsVersion: SANGFOR_JWT_CLAIMS_VERSION,
    ttlSeconds: SANGFOR_JWT_TTL_SECONDS,
    clockSkewSeconds: SANGFOR_JWT_CLOCK_SKEW_SECONDS,
    rotationOwner,
    activeKid: active.kid,
    active,
    verifyOnly,
    retiredKids,
  };
}

/** Reads the live `USER_JWT_*` boundary from `process.env`. See {@link parseUserJwtConfig}. */
export function getUserJwtConfig(now?: number): UserJwtConfig {
  return parseUserJwtConfig(process.env, now);
}
