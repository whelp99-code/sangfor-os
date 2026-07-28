/**
 * U026/OPS-01 — the only typed environment boundary for signed internal
 * principals.  It deliberately has no cache: a process must fail closed when
 * its currently installed rotation state is invalid.
 */
import { z } from 'zod';

export const INTERNAL_PRINCIPAL_WIRE_VERSION = 'sangfor.internal-principal/v1' as const;
export const INTERNAL_PRINCIPAL_KEYRING_VERSION = 'sangfor.internal-principal-keyring/v1' as const;
export const INTERNAL_PRINCIPAL_ALGORITHM = 'HS256' as const;
export const INTERNAL_PRINCIPAL_TYPE = 'sangfor-internal-principal+jwt' as const;
export const INTERNAL_PRINCIPAL_TTL_SECONDS = 60 as const;
export const INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS = 5 as const;
export const INTERNAL_PRINCIPAL_ROTATION_OWNER = 'security-auth' as const;

export const INTERNAL_PRINCIPAL_PROFILES = ['FINANCE', 'SCHEDULER', 'WORKFLOW', 'ENGINEER'] as const;
export type InternalPrincipalProfile = (typeof INTERNAL_PRINCIPAL_PROFILES)[number];
export type InternalPrincipalSubjectType = 'human_delegation' | 'service';
export type InternalPrincipalKeyState = 'active' | 'verify_only' | 'retired';

export const INTERNAL_PRINCIPAL_PROFILE_CONSTANTS: Readonly<Record<InternalPrincipalProfile, {
  readonly issuer: string;
  readonly audience: string;
  readonly subjectType: InternalPrincipalSubjectType;
  readonly serviceId: string | null;
  readonly capabilities: readonly string[];
}>> = Object.freeze({
  FINANCE: {
    issuer: 'sangfor-web', audience: 'sangfor-api-finance', subjectType: 'human_delegation', serviceId: null,
    capabilities: ['finance.read', 'finance.write', 'finance.approve_margin'],
  },
  SCHEDULER: {
    issuer: 'sangfor-scheduler', audience: 'sangfor-web-scheduler', subjectType: 'service', serviceId: 'sangfor-scheduler',
    capabilities: ['agent.schedule.tick'],
  },
  WORKFLOW: {
    issuer: 'sangfor-mcp-workflow', audience: 'sangfor-web-workflow', subjectType: 'service', serviceId: 'sangfor-mcp-workflow',
    capabilities: ['workflow.definition.create', 'workflow.definition.read', 'workflow.definition.activate', 'workflow.run.create', 'workflow.run.read', 'workflow.run.callback'],
  },
  ENGINEER: {
    issuer: 'sangfor-engineer-mcp', audience: 'sangfor-web-external-action', subjectType: 'service', serviceId: 'sangfor-engineer-mcp',
    capabilities: ['external_action.receipt.consume'],
  },
});

export const INTERNAL_PRINCIPAL_KID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RFC3339_SECONDS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface InternalPrincipalKeyringEntry {
  readonly kid: string;
  readonly state: InternalPrincipalKeyState;
  readonly secretBase64Url: string | null;
  readonly activatedAt: string;
  readonly demotedAt: string | null;
  readonly verificationCutoff: string | null;
  readonly retiredAt: string | null;
}

export interface InternalPrincipalKeyring {
  readonly version: typeof INTERNAL_PRINCIPAL_KEYRING_VERSION;
  readonly keys: readonly InternalPrincipalKeyringEntry[];
}

export interface InternalPrincipalActiveKey {
  readonly kid: string;
  readonly secret: Buffer;
  readonly activatedAtSeconds: number;
}

export interface InternalPrincipalVerifyOnlyKey {
  readonly kid: string;
  readonly secret: Buffer;
  readonly activatedAtSeconds: number;
  readonly demotedAtSeconds: number;
  readonly verificationCutoffSeconds: number;
}

export interface InternalPrincipalProfileConfig {
  readonly profile: InternalPrincipalProfile;
  readonly issuer: string;
  readonly audience: string;
  readonly subjectType: InternalPrincipalSubjectType;
  readonly serviceId: string | null;
  readonly capabilities: readonly string[];
  readonly activeKid: string;
  readonly active: InternalPrincipalActiveKey;
  readonly verifyOnly: ReadonlyMap<string, InternalPrincipalVerifyOnlyKey>;
  readonly retiredKids: ReadonlySet<string>;
}

export interface InternalPrincipalConfig {
  readonly wireVersion: typeof INTERNAL_PRINCIPAL_WIRE_VERSION;
  readonly ttlSeconds: typeof INTERNAL_PRINCIPAL_TTL_SECONDS;
  readonly clockSkewSeconds: typeof INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS;
  readonly rotationOwner: typeof INTERNAL_PRINCIPAL_ROTATION_OWNER;
  readonly profiles: Readonly<Record<InternalPrincipalProfile, InternalPrincipalProfileConfig>>;
}

export interface ParseInternalPrincipalConfigEnv {
  readonly INTERNAL_PRINCIPAL_TTL_SECONDS?: string;
  readonly INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS?: string;
  readonly INTERNAL_PRINCIPAL_ROTATION_OWNER?: string;
  readonly INTERNAL_PRINCIPAL_FINANCE_ACTIVE_KID?: string;
  readonly INTERNAL_PRINCIPAL_FINANCE_KEYRING_JSON?: string;
  readonly INTERNAL_PRINCIPAL_SCHEDULER_ACTIVE_KID?: string;
  readonly INTERNAL_PRINCIPAL_SCHEDULER_KEYRING_JSON?: string;
  readonly INTERNAL_PRINCIPAL_WORKFLOW_ACTIVE_KID?: string;
  readonly INTERNAL_PRINCIPAL_WORKFLOW_KEYRING_JSON?: string;
  readonly INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID?: string;
  readonly INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON?: string;
}

export class InternalPrincipalConfigError extends Error {
  constructor(message: string) {
    super(`INTERNAL_PRINCIPAL config: ${message}`);
    this.name = 'InternalPrincipalConfigError';
  }
}

const KeyringEntrySchema = z.object({
  kid: z.string(),
  state: z.enum(['active', 'verify_only', 'retired']),
  secretBase64Url: z.string().nullable(),
  activatedAt: z.string(),
  demotedAt: z.string().nullable(),
  verificationCutoff: z.string().nullable(),
  retiredAt: z.string().nullable(),
}).strict();
const KeyringSchema = z.object({
  version: z.literal(INTERNAL_PRINCIPAL_KEYRING_VERSION),
  keys: z.array(KeyringEntrySchema),
}).strict();

function fail(message: string): never {
  throw new InternalPrincipalConfigError(message);
}

function profilePrefix(profile: InternalPrincipalProfile): `INTERNAL_PRINCIPAL_${InternalPrincipalProfile}` {
  return `INTERNAL_PRINCIPAL_${profile}`;
}

function parseTimestamp(value: string, field: string): number {
  if (!RFC3339_SECONDS_PATTERN.test(value)) fail(`${field} must be a UTC RFC3339-seconds timestamp`);
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds) || new Date(milliseconds).toISOString().replace(/\.\d{3}Z$/, 'Z') !== value) {
    fail(`${field} is not a valid UTC RFC3339-seconds timestamp`);
  }
  return Math.floor(milliseconds / 1_000);
}

function decodeSecret(value: string, field: string): Buffer {
  if (!BASE64URL_PATTERN.test(value)) fail(`${field} must be canonical unpadded base64url`);
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) fail(`${field} must be canonical unpadded base64url`);
  if (decoded.length < 32 || decoded.length > 64) fail(`${field} must decode to 32-64 bytes`);
  return decoded;
}

function parseProfile(profile: InternalPrincipalProfile, env: ParseInternalPrincipalConfigEnv, now: number): InternalPrincipalProfileConfig {
  const prefix = profilePrefix(profile);
  const activeKidRaw = env[`${prefix}_ACTIVE_KID` as keyof ParseInternalPrincipalConfigEnv]?.trim();
  if (!activeKidRaw || !INTERNAL_PRINCIPAL_KID_PATTERN.test(activeKidRaw)) fail(`${prefix}_ACTIVE_KID is required and must match the kid pattern`);
  const keyringRaw = env[`${prefix}_KEYRING_JSON` as keyof ParseInternalPrincipalConfigEnv];
  if (!keyringRaw?.trim()) fail(`${prefix}_KEYRING_JSON is required`);
  let raw: unknown;
  try { raw = JSON.parse(keyringRaw); } catch { fail(`${prefix}_KEYRING_JSON is invalid JSON`); }
  const result = KeyringSchema.safeParse(raw);
  if (!result.success) fail(`${prefix}_KEYRING_JSON has an invalid exact shape`);

  const seenKids = new Set<string>();
  let active: InternalPrincipalActiveKey | undefined;
  const verifyOnly = new Map<string, InternalPrincipalVerifyOnlyKey>();
  const retiredKids = new Set<string>();
  for (const entry of result.data.keys) {
    if (!INTERNAL_PRINCIPAL_KID_PATTERN.test(entry.kid)) fail(`${prefix} key has malformed kid`);
    if (seenKids.has(entry.kid)) fail(`${prefix} contains duplicate kid ${entry.kid}`);
    seenKids.add(entry.kid);
    const activatedAtSeconds = parseTimestamp(entry.activatedAt, `${prefix}.${entry.kid}.activatedAt`);
    if (entry.state === 'active') {
      if (entry.secretBase64Url === null || entry.demotedAt !== null || entry.verificationCutoff !== null || entry.retiredAt !== null) {
        fail(`${prefix} active key ${entry.kid} has invalid rotation fields`);
      }
      if (active) fail(`${prefix} has multiple active keys`);
      active = { kid: entry.kid, secret: decodeSecret(entry.secretBase64Url, `${prefix}.${entry.kid}.secretBase64Url`), activatedAtSeconds };
      continue;
    }
    if (entry.state === 'verify_only') {
      if (entry.secretBase64Url === null || entry.demotedAt === null || entry.verificationCutoff === null || entry.retiredAt !== null) {
        fail(`${prefix} verify_only key ${entry.kid} has invalid rotation fields`);
      }
      const demotedAtSeconds = parseTimestamp(entry.demotedAt, `${prefix}.${entry.kid}.demotedAt`);
      const verificationCutoffSeconds = parseTimestamp(entry.verificationCutoff, `${prefix}.${entry.kid}.verificationCutoff`);
      if (activatedAtSeconds >= demotedAtSeconds || verificationCutoffSeconds !== demotedAtSeconds + 65) {
        fail(`${prefix} verify_only key ${entry.kid} must have activatedAt < demotedAt and cutoff D+65`);
      }
      if (now > verificationCutoffSeconds) fail(`${prefix} verify_only key ${entry.kid} is overdue for secret-free retirement`);
      verifyOnly.set(entry.kid, { kid: entry.kid, secret: decodeSecret(entry.secretBase64Url, `${prefix}.${entry.kid}.secretBase64Url`), activatedAtSeconds, demotedAtSeconds, verificationCutoffSeconds });
      continue;
    }
    if (entry.secretBase64Url !== null || entry.demotedAt === null || entry.verificationCutoff === null || entry.retiredAt === null) {
      fail(`${prefix} retired key ${entry.kid} must be a secret-free tombstone`);
    }
    const demotedAtSeconds = parseTimestamp(entry.demotedAt, `${prefix}.${entry.kid}.demotedAt`);
    const verificationCutoffSeconds = parseTimestamp(entry.verificationCutoff, `${prefix}.${entry.kid}.verificationCutoff`);
    const retiredAtSeconds = parseTimestamp(entry.retiredAt, `${prefix}.${entry.kid}.retiredAt`);
    if (!(demotedAtSeconds <= retiredAtSeconds && retiredAtSeconds <= verificationCutoffSeconds)) {
      fail(`${prefix} retired key ${entry.kid} has impossible timestamps`);
    }
    retiredKids.add(entry.kid);
  }
  if (!active || active.kid !== activeKidRaw) fail(`${prefix}_ACTIVE_KID must name the exactly one active key`);
  const constants = INTERNAL_PRINCIPAL_PROFILE_CONSTANTS[profile];
  return { profile, ...constants, activeKid: active.kid, active, verifyOnly, retiredKids };
}

/** Parses all four keyrings together so secret/kid reuse cannot be hidden by a per-profile call. */
export function parseInternalPrincipalConfig(env: ParseInternalPrincipalConfigEnv, now = Math.floor(Date.now() / 1_000)): InternalPrincipalConfig {
  if (env.INTERNAL_PRINCIPAL_TTL_SECONDS?.trim() !== String(INTERNAL_PRINCIPAL_TTL_SECONDS)) fail(`INTERNAL_PRINCIPAL_TTL_SECONDS must equal ${INTERNAL_PRINCIPAL_TTL_SECONDS}`);
  if (env.INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS?.trim() !== String(INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS)) fail(`INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS must equal ${INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS}`);
  if (env.INTERNAL_PRINCIPAL_ROTATION_OWNER?.trim() !== INTERNAL_PRINCIPAL_ROTATION_OWNER) fail(`INTERNAL_PRINCIPAL_ROTATION_OWNER must equal ${INTERNAL_PRINCIPAL_ROTATION_OWNER}`);
  if (!Number.isSafeInteger(now)) fail('now must be a safe Unix-second integer');

  const profiles = Object.fromEntries(INTERNAL_PRINCIPAL_PROFILES.map((profile) => [profile, parseProfile(profile, env, now)])) as Record<InternalPrincipalProfile, InternalPrincipalProfileConfig>;
  const kids = new Set<string>();
  const secrets = new Set<string>();
  for (const config of Object.values(profiles)) {
    for (const key of [config.active, ...config.verifyOnly.values()]) {
      if (kids.has(key.kid)) fail(`cross-profile key id reuse is forbidden: ${key.kid}`);
      const encoded = key.secret.toString('base64url');
      if (secrets.has(encoded)) fail(`cross-profile key secret reuse is forbidden`);
      kids.add(key.kid); secrets.add(encoded);
    }
  }
  return { wireVersion: INTERNAL_PRINCIPAL_WIRE_VERSION, ttlSeconds: INTERNAL_PRINCIPAL_TTL_SECONDS, clockSkewSeconds: INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS, rotationOwner: INTERNAL_PRINCIPAL_ROTATION_OWNER, profiles };
}

export function getInternalPrincipalConfig(now?: number): InternalPrincipalConfig {
  return parseInternalPrincipalConfig(process.env, now);
}

/** RFC8785-JCS producer for the narrow protocol objects. No locale ordering or JSON.stringify. */
export function canonicalizeInternalPrincipalJson(value: unknown): string {
  const quote = (input: string) => {
    let output = '"';
    for (let i = 0; i < input.length; i += 1) {
      const char = input[i]!; const code = input.charCodeAt(i);
      if (char === '"') output += '\\"'; else if (char === '\\') output += '\\\\';
      else if (code === 8) output += '\\b'; else if (code === 9) output += '\\t'; else if (code === 10) output += '\\n';
      else if (code === 12) output += '\\f'; else if (code === 13) output += '\\r';
      else if (code < 0x20) output += `\\u${code.toString(16).padStart(4, '0')}`; else output += char;
    }
    return `${output}"`;
  };
  const canon = (entry: unknown): string => {
    if (entry === null) return 'null';
    if (entry === true || entry === false) return String(entry);
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) throw new InternalPrincipalConfigError('cannot canonicalize non-finite number'); return String(entry); }
    if (typeof entry === 'string') return quote(entry);
    if (Array.isArray(entry)) return `[${entry.map(canon).join(',')}]`;
    if (entry && typeof entry === 'object') {
      return `{${Object.keys(entry as Record<string, unknown>).sort().map((key) => `${quote(key)}:${canon((entry as Record<string, unknown>)[key])}`).join(',')}}`;
    }
    throw new InternalPrincipalConfigError('cannot canonicalize a non-JSON value');
  };
  return canon(value);
}
