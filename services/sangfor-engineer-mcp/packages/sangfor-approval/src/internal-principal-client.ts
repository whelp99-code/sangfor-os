/** U027 engineer-side U026 ENGINEER signer. It owns no receipt key and cannot issue receipts. */
import { createHash, createHmac, randomBytes as nodeRandomBytes } from 'node:crypto';

const B64URL = /^[A-Za-z0-9_-]+$/;
const KID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const ENGINEER_INTERNAL_PRINCIPAL_PROFILE = 'ENGINEER' as const;
export const ENGINEER_INTERNAL_PRINCIPAL_CAPABILITY = 'external_action.receipt.consume' as const;
export const ENGINEER_INTERNAL_PRINCIPAL_PATH = '/api/internal/external-actions/receipts/consume' as const;

export class EngineerInternalPrincipalConfigError extends Error { constructor(message: string) { super(`ENGINEER internal principal: ${message}`); } }
export interface EngineerPrincipalScope { readonly tenantId: string; readonly companyId: string; readonly projectId: string; }
export interface EngineerPrincipalInput extends EngineerPrincipalScope { readonly method: 'POST'; readonly path: typeof ENGINEER_INTERNAL_PRINCIPAL_PATH; readonly query: ''; readonly body: string; readonly idempotencyKey: string; }
export interface EngineerPrincipalConfig { readonly rootUrl: string; readonly ttlSeconds: 60; readonly clockSkewSeconds: 5; readonly kid: string; readonly secret: Buffer; }
export interface EngineerPrincipalEnv { readonly SANGFOR_ROOT_URL?: string; readonly INTERNAL_PRINCIPAL_TTL_SECONDS?: string; readonly INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS?: string; readonly INTERNAL_PRINCIPAL_ROTATION_OWNER?: string; readonly INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID?: string; readonly INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON?: string; }

function canonical(value: unknown): string {
  const quote = (text: string) => JSON.stringify(text).replace(/\\u([0-9a-f]{4})/g, (_, code) => `\\u${String(code).toLowerCase()}`);
  const write = (item: unknown): string => {
    if (item === null || typeof item === 'boolean') return String(item);
    if (typeof item === 'string') return quote(item);
    if (typeof item === 'number') { if (!Number.isFinite(item)) throw new EngineerInternalPrincipalConfigError('non-finite canonical JSON'); return String(item); }
    if (Array.isArray(item)) return `[${item.map(write).join(',')}]`;
    if (item && typeof item === 'object') return `{${Object.keys(item as Record<string, unknown>).sort().map(key => `${quote(key)}:${write((item as Record<string, unknown>)[key])}`).join(',')}}`;
    throw new EngineerInternalPrincipalConfigError('non-JSON canonical value');
  };
  return write(value);
}
function digest(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
function decode(value: unknown): Buffer {
  if (typeof value !== 'string' || !B64URL.test(value)) throw new EngineerInternalPrincipalConfigError('key must be unpadded base64url');
  const key = Buffer.from(value, 'base64url'); if (key.toString('base64url') !== value || key.length < 32 || key.length > 64) throw new EngineerInternalPrincipalConfigError('key must decode to 32-64 bytes'); return key;
}
export function parseEngineerInternalPrincipalConfig(env: EngineerPrincipalEnv = process.env): EngineerPrincipalConfig {
  const rootUrl = env.SANGFOR_ROOT_URL?.trim(); if (!rootUrl) throw new EngineerInternalPrincipalConfigError('SANGFOR_ROOT_URL is required');
  try { new URL(rootUrl); } catch { throw new EngineerInternalPrincipalConfigError('SANGFOR_ROOT_URL must be an absolute URL'); }
  if (env.INTERNAL_PRINCIPAL_TTL_SECONDS !== '60' || env.INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS !== '5' || env.INTERNAL_PRINCIPAL_ROTATION_OWNER !== 'security-auth') throw new EngineerInternalPrincipalConfigError('fixed U026 constants are required');
  const kid = env.INTERNAL_PRINCIPAL_ENGINEER_ACTIVE_KID?.trim(); if (!kid || !KID.test(kid)) throw new EngineerInternalPrincipalConfigError('ENGINEER active kid is invalid');
  let raw: unknown; try { raw = JSON.parse(env.INTERNAL_PRINCIPAL_ENGINEER_KEYRING_JSON ?? ''); } catch { throw new EngineerInternalPrincipalConfigError('ENGINEER keyring JSON is invalid'); }
  if (!raw || Array.isArray(raw) || typeof raw !== 'object' || Object.keys(raw as object).sort().join(',') !== 'keys,version') throw new EngineerInternalPrincipalConfigError('ENGINEER keyring shape is invalid');
  const keys = (raw as { keys?: unknown }).keys; if (!Array.isArray(keys)) throw new EngineerInternalPrincipalConfigError('ENGINEER keyring keys is invalid');
  const active = keys.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry) && (entry as Record<string, unknown>).state === 'active');
  if (active.length !== 1 || active[0]!.kid !== kid) throw new EngineerInternalPrincipalConfigError('exactly one active ENGINEER key is required');
  const entry = active[0]!; if (Object.keys(entry).sort().join(',') !== 'activatedAt,demotedAt,kid,retiredAt,secretBase64Url,state,verificationCutoff' || entry.demotedAt !== null || entry.retiredAt !== null || entry.verificationCutoff !== null) throw new EngineerInternalPrincipalConfigError('ENGINEER active key lifecycle is invalid');
  return { rootUrl: rootUrl.replace(/\/$/, ''), ttlSeconds: 60, clockSkewSeconds: 5, kid, secret: decode(entry.secretBase64Url) };
}
function nonce(random: () => Buffer): string { const value = random(); if (!Buffer.isBuffer(value) || value.length !== 16) throw new EngineerInternalPrincipalConfigError('random source must return 128 bits'); return value.toString('base64url'); }
export function issueEngineerInternalPrincipal(input: EngineerPrincipalInput, config: EngineerPrincipalConfig, options: { now?: number; randomBytes?: () => Buffer } = {}): string {
  for (const value of [input.tenantId, input.companyId, input.projectId, input.idempotencyKey]) if (!value) throw new EngineerInternalPrincipalConfigError('scope and idempotency are required');
  const now = options.now ?? Math.floor(Date.now() / 1000); if (!Number.isSafeInteger(now)) throw new EngineerInternalPrincipalConfigError('clock must be a safe integer');
  const random = options.randomBytes ?? (() => nodeRandomBytes(16));
  const header = { alg: 'HS256', kid: config.kid, typ: 'sangfor-internal-principal+jwt', v: 1 };
  const payload = { audience: 'sangfor-web-external-action', bodyHash: digest(input.body), businessRole: null, capabilities: [ENGINEER_INTERNAL_PRINCIPAL_CAPABILITY], companyId: input.companyId, exp: now + 60, iat: now, idempotencyKey: input.idempotencyKey, issuer: 'sangfor-engineer-mcp', jti: nonce(random), method: input.method, nbf: now - 5, nonce: nonce(random), path: input.path, profile: ENGINEER_INTERNAL_PRINCIPAL_PROFILE, projectId: input.projectId, queryHash: digest(input.query), sessionId: null, subjectId: 'sangfor-engineer-mcp', subjectType: 'service', tenantId: input.tenantId };
  const protectedSegment = Buffer.from(canonical(header), 'utf8').toString('base64url'); const payloadSegment = Buffer.from(canonical(payload), 'utf8').toString('base64url');
  return `${protectedSegment}.${payloadSegment}.${createHmac('sha256', config.secret).update(`${protectedSegment}.${payloadSegment}`, 'utf8').digest('base64url')}`;
}
