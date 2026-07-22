/** U026/OPS-01 compact, request-bound internal-principal JWS protocol. */
import { createHash, createHmac, randomBytes as nodeRandomBytes, timingSafeEqual } from 'node:crypto';
import { TextDecoder } from 'node:util';
import {
  INTERNAL_PRINCIPAL_ALGORITHM,
  INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS,
  INTERNAL_PRINCIPAL_TYPE,
  INTERNAL_PRINCIPAL_WIRE_VERSION,
  canonicalizeInternalPrincipalJson,
  type InternalPrincipalConfig,
  type InternalPrincipalProfile,
  type InternalPrincipalSubjectType,
} from '@sangfor/config';
import type { BusinessRole } from './types';

export const INTERNAL_PRINCIPAL_HEADER = 'x-sangfor-internal-principal' as const;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const BUSINESS_ROLES = new Set<BusinessRole>(['ceo', 'sales_manager', 'account_manager', 'presales_engineer', 'solution_architect', 'finance_manager', 'delivery_engineer', 'support_engineer', 'security_officer', 'system_admin']);
const PAYLOAD_KEYS = ['audience', 'bodyHash', 'businessRole', 'capabilities', 'companyId', 'exp', 'iat', 'idempotencyKey', 'issuer', 'jti', 'method', 'nbf', 'nonce', 'path', 'profile', 'projectId', 'queryHash', 'sessionId', 'subjectId', 'subjectType', 'tenantId'] as const;

/** The closed root vocabulary U028 must consume; no service request supplies a capability. */
export const WORKFLOW_ROOT_CAPABILITY_REGISTRY = Object.freeze({
  'POST /api/workflows/definitions': 'workflow.definition.create',
  'GET /api/workflows/definitions/:id': 'workflow.definition.read',
  'POST /api/workflows/definitions/:id/activate': 'workflow.definition.activate',
  'POST /api/workflows/runs': 'workflow.run.create',
  'GET /api/workflows/runs/:id': 'workflow.run.read',
  'POST /api/workflows/runs/:id/callback': 'workflow.run.callback',
} as const);

export function resolveWorkflowRootCapability(method: string, pathname: string): string | null {
  const normalized = `${normalizedMethod(method)} ${normalizedPath(pathname).replace(/\/[A-Za-z0-9_-]+(?=\/activate$|\/callback$|$)/, '/:id')}`;
  return WORKFLOW_ROOT_CAPABILITY_REGISTRY[normalized as keyof typeof WORKFLOW_ROOT_CAPABILITY_REGISTRY] ?? null;
}

export interface IssueInternalPrincipalInput {
  readonly profile: InternalPrincipalProfile;
  readonly subjectType: InternalPrincipalSubjectType;
  readonly subjectId: string;
  readonly sessionId: string | null;
  readonly tenantId: string;
  readonly companyId: string;
  readonly projectId: string;
  readonly businessRole: BusinessRole | null;
  readonly capabilities: readonly string[];
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly body: string;
  readonly idempotencyKey: string;
}

export interface IssueInternalPrincipalOptions {
  readonly now?: number;
  readonly randomBytes?: () => Buffer;
}

export interface VerifyInternalPrincipalRequest {
  readonly profile: InternalPrincipalProfile;
  readonly method: string;
  readonly path: string;
  readonly query: string;
  readonly body: string;
}

export interface VerifiedInternalPrincipal {
  readonly issuer: string;
  readonly audience: string;
  readonly profile: InternalPrincipalProfile;
  readonly subjectType: InternalPrincipalSubjectType;
  readonly subjectId: string;
  readonly sessionId: string | null;
  readonly tenantId: string;
  readonly companyId: string;
  readonly projectId: string;
  readonly businessRole: BusinessRole | null;
  readonly capabilities: readonly string[];
  readonly method: string;
  readonly path: string;
  readonly queryHash: string;
  readonly bodyHash: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly jti: string;
  readonly nonce: string;
  readonly idempotencyKey: string;
}

export class InternalPrincipalVerificationError extends Error {
  constructor(message: string) {
    super(`internal principal rejected: ${message}`);
    this.name = 'InternalPrincipalVerificationError';
  }
}

function reject(message: string): never {
  throw new InternalPrincipalVerificationError(message);
}

function safeNow(now: number): number {
  if (!Number.isSafeInteger(now)) reject('clock must be a safe Unix-second integer');
  return now;
}

function normalizedMethod(method: string): string {
  const normalized = method.toUpperCase();
  if (!/^[A-Z]+$/.test(normalized) || method !== normalized) reject('HTTP method must be canonical uppercase');
  return normalized;
}

function normalizedPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('?') || path.includes('#')) reject('path must be normalized absolute pathname');
  const canonical = new URL(path, 'http://internal.invalid').pathname;
  if (canonical !== path || path.includes('/../') || path.includes('/./')) reject('path is not normalized');
  return path;
}

function normalizedQuery(query: string): string {
  if (query === '') return '';
  if (!query.startsWith('?') || query.includes('#')) reject('query must be an exact search string');
  return query;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function randomIdentifier(random: () => Buffer): string {
  const bytes = random();
  if (!Buffer.isBuffer(bytes) || bytes.length !== 16) reject('random generator must return exactly 128 bits');
  return bytes.toString('base64url');
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
}

function decodeSegment(segment: string, what: string): string {
  if (!BASE64URL.test(segment)) reject(`${what} is not unpadded base64url`);
  const bytes = Buffer.from(segment, 'base64url');
  if (bytes.toString('base64url') !== segment) reject(`${what} is not canonical base64url`);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { reject(`${what} is not UTF-8`); }
}

function parseCanonicalObject(segment: string, what: string): Record<string, unknown> {
  const source = decodeSegment(segment, what);
  let value: unknown;
  try { value = JSON.parse(source); } catch { reject(`${what} is invalid JSON`); }
  if (!value || Array.isArray(value) || typeof value !== 'object') reject(`${what} must be an object`);
  let canonical: string;
  try { canonical = canonicalizeInternalPrincipalJson(value); } catch { reject(`${what} is not JCS`); }
  // This byte comparison rejects alternate serializations and duplicate member
  // names (JSON.parse would otherwise collapse the latter silently).
  if (source !== canonical) reject(`${what} is not canonical JCS`);
  return value as Record<string, unknown>;
}

function canonicalCapabilities(capabilities: readonly string[], profile: InternalPrincipalProfile): string[] {
  const allowed = new Set(profile === 'FINANCE'
    ? ['finance.read', 'finance.write', 'finance.approve_margin']
    : profile === 'SCHEDULER' ? ['agent.schedule.tick']
      : profile === 'WORKFLOW' ? ['workflow.definition.create', 'workflow.definition.read', 'workflow.definition.activate', 'workflow.run.create', 'workflow.run.read', 'workflow.run.callback']
        : ['external_action.receipt.consume']);
  if (capabilities.length === 0 || capabilities.some((capability) => !allowed.has(capability))) reject(`capabilities are not allowed for ${profile}`);
  const sorted = [...capabilities].sort();
  if (new Set(sorted).size !== sorted.length) reject('capabilities must be unique');
  if ((profile === 'SCHEDULER' || profile === 'ENGINEER') && (sorted.length !== 1 || sorted[0] !== [...allowed][0])) reject(`${profile} requires its sole capability`);
  return sorted;
}

function assertProfileSubject(input: Pick<IssueInternalPrincipalInput, 'profile' | 'subjectType' | 'subjectId' | 'sessionId' | 'businessRole' | 'capabilities'>, config: InternalPrincipalConfig): void {
  const expected = config.profiles[input.profile];
  if (input.subjectType !== expected.subjectType) reject('subject type does not match profile');
  if (!input.subjectId || input.subjectId.length > 255) reject('subject id is required');
  canonicalCapabilities(input.capabilities, input.profile);
  if (input.subjectType === 'human_delegation') {
    if (!input.sessionId || !input.businessRole || !BUSINESS_ROLES.has(input.businessRole)) reject('finance delegation requires user session and BusinessRole');
    return;
  }
  if (input.sessionId !== null || input.businessRole !== null || input.subjectId !== expected.serviceId) reject('service profile identity must be exact');
}

function assertScope(input: Pick<IssueInternalPrincipalInput, 'tenantId' | 'companyId' | 'projectId' | 'idempotencyKey'>): void {
  for (const [name, value] of Object.entries(input)) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 255) reject(`${name} is required`);
  }
}

/** Issues exactly one protected HS256 JWS envelope; callers supply only server-derived facts. */
export function issueInternalPrincipal(input: IssueInternalPrincipalInput, config: InternalPrincipalConfig, options: IssueInternalPrincipalOptions = {}): string {
  const now = safeNow(options.now ?? Math.floor(Date.now() / 1_000));
  assertProfileSubject(input, config);
  assertScope({ tenantId: input.tenantId, companyId: input.companyId, projectId: input.projectId, idempotencyKey: input.idempotencyKey });
  const profile = config.profiles[input.profile];
  const method = normalizedMethod(input.method); const path = normalizedPath(input.path); const query = normalizedQuery(input.query);
  const capabilities = canonicalCapabilities(input.capabilities, input.profile);
  const random = options.randomBytes ?? (() => nodeRandomBytes(16));
  const header = { alg: INTERNAL_PRINCIPAL_ALGORITHM, kid: profile.active.kid, typ: INTERNAL_PRINCIPAL_TYPE, v: 1 };
  const payload: VerifiedInternalPrincipal = {
    issuer: profile.issuer, audience: profile.audience, profile: input.profile, subjectType: input.subjectType, subjectId: input.subjectId,
    sessionId: input.sessionId, tenantId: input.tenantId, companyId: input.companyId, projectId: input.projectId, businessRole: input.businessRole,
    capabilities, method, path, queryHash: sha256(query), bodyHash: sha256(input.body),
    iat: now, nbf: now - INTERNAL_PRINCIPAL_CLOCK_SKEW_SECONDS, exp: now + config.ttlSeconds,
    jti: randomIdentifier(random), nonce: randomIdentifier(random), idempotencyKey: input.idempotencyKey,
  };
  const protectedSegment = Buffer.from(canonicalizeInternalPrincipalJson(header), 'utf8').toString('base64url');
  const payloadSegment = Buffer.from(canonicalizeInternalPrincipalJson(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', profile.active.secret).update(`${protectedSegment}.${payloadSegment}`, 'utf8').digest('base64url');
  return `${protectedSegment}.${payloadSegment}.${signature}`;
}

function verifiedPayload(value: Record<string, unknown>, expected: VerifyInternalPrincipalRequest, config: InternalPrincipalConfig, now: number): VerifiedInternalPrincipal {
  if (!exactKeys(value, PAYLOAD_KEYS)) reject('payload has missing or unknown claims');
  const profile = value.profile;
  if (!['FINANCE', 'SCHEDULER', 'WORKFLOW', 'ENGINEER'].includes(String(profile)) || profile !== expected.profile) reject('profile mismatch');
  const profileConfig = config.profiles[profile as InternalPrincipalProfile];
  const stringClaims = ['issuer', 'audience', 'subjectId', 'tenantId', 'companyId', 'projectId', 'method', 'path', 'queryHash', 'bodyHash', 'jti', 'nonce', 'idempotencyKey'] as const;
  for (const claim of stringClaims) if (typeof value[claim] !== 'string' || value[claim].length === 0) reject(`invalid ${claim}`);
  if (value.issuer !== profileConfig.issuer || value.audience !== profileConfig.audience) reject('issuer/audience mismatch');
  if (value.subjectType !== profileConfig.subjectType) reject('subject type mismatch');
  if (value.sessionId !== null && typeof value.sessionId !== 'string') reject('invalid sessionId');
  if (value.businessRole !== null && (typeof value.businessRole !== 'string' || !BUSINESS_ROLES.has(value.businessRole as BusinessRole))) reject('invalid BusinessRole');
  if (!Array.isArray(value.capabilities) || value.capabilities.some((capability) => typeof capability !== 'string')) reject('invalid capabilities');
  const capabilities = canonicalCapabilities(value.capabilities as string[], profile as InternalPrincipalProfile);
  if (canonicalizeInternalPrincipalJson(value.capabilities) !== canonicalizeInternalPrincipalJson(capabilities)) reject('capabilities must be canonical');
  const subjectType = value.subjectType as InternalPrincipalSubjectType;
  assertProfileSubject({ profile: profile as InternalPrincipalProfile, subjectType, subjectId: value.subjectId as string, sessionId: value.sessionId as string | null, businessRole: value.businessRole as BusinessRole | null, capabilities }, config);
  for (const claim of ['iat', 'nbf', 'exp'] as const) if (!Number.isSafeInteger(value[claim])) reject(`invalid ${claim}`);
  const iat = value.iat as number; const nbf = value.nbf as number; const exp = value.exp as number;
  if (nbf !== iat - config.clockSkewSeconds || exp !== iat + config.ttlSeconds || now < nbf || now > exp) reject('lifetime or clock skew mismatch');
  for (const claim of ['jti', 'nonce'] as const) {
    const id = value[claim] as string;
    if (id.length !== 22 || !BASE64URL.test(id) || Buffer.from(id, 'base64url').length !== 16) reject(`invalid ${claim}`);
  }
  const method = normalizedMethod(expected.method); const path = normalizedPath(expected.path); const query = normalizedQuery(expected.query);
  if (value.method !== method || value.path !== path || value.queryHash !== sha256(query) || value.bodyHash !== sha256(expected.body)) reject('request binding mismatch');
  return { issuer: value.issuer as string, audience: value.audience as string, profile: profile as InternalPrincipalProfile, subjectType,
    subjectId: value.subjectId as string, sessionId: value.sessionId as string | null, tenantId: value.tenantId as string, companyId: value.companyId as string, projectId: value.projectId as string,
    businessRole: value.businessRole as BusinessRole | null, capabilities, method: value.method as string, path: value.path as string,
    queryHash: value.queryHash as string, bodyHash: value.bodyHash as string, iat, nbf, exp, jti: value.jti as string, nonce: value.nonce as string, idempotencyKey: value.idempotencyKey as string };
}

/** Verifies exact JWS bytes, the closed profile matrix, rotation state, and bound HTTP request. */
export function verifyInternalPrincipal(token: string, expected: VerifyInternalPrincipalRequest, config: InternalPrincipalConfig, nowInput = Math.floor(Date.now() / 1_000)): VerifiedInternalPrincipal {
  const now = safeNow(nowInput); const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) reject('compact JWS must have three non-empty segments');
  const [headerSegment, payloadSegment, signatureSegment] = segments as [string, string, string];
  const header = parseCanonicalObject(headerSegment, 'protected header');
  if (!exactKeys(header, ['alg', 'kid', 'typ', 'v']) || header.alg !== INTERNAL_PRINCIPAL_ALGORITHM || header.typ !== INTERNAL_PRINCIPAL_TYPE || header.v !== 1 || typeof header.kid !== 'string') reject('protected header drift');
  const payload = parseCanonicalObject(payloadSegment, 'payload');
  const profile = expected.profile; const profileConfig = config.profiles[profile];
  const payloadForRotation = verifiedPayload(payload, expected, config, now);
  let key = header.kid === profileConfig.active.kid ? profileConfig.active : profileConfig.verifyOnly.get(header.kid);
  if (!key) reject('unknown, retired, or cross-profile kid');
  if (isVerifyOnlyKey(key) && !(payloadForRotation.iat < key.demotedAtSeconds && payloadForRotation.exp <= key.demotedAtSeconds + config.ttlSeconds && now <= key.verificationCutoffSeconds)) {
    reject('verify-only key outside bounded rotation window');
  }
  if (!BASE64URL.test(signatureSegment)) reject('signature is not unpadded base64url');
  const actual = Buffer.from(signatureSegment, 'base64url');
  if (actual.toString('base64url') !== signatureSegment) reject('signature is not canonical base64url');
  const signed = Buffer.from(`${headerSegment}.${payloadSegment}`, 'utf8');
  const expectedSignature = createHmac('sha256', key.secret).update(signed).digest();
  if (actual.length !== expectedSignature.length || !timingSafeEqual(actual, expectedSignature)) reject('signature mismatch');
  return payloadForRotation;
}

function isVerifyOnlyKey(key: { readonly kid: string; readonly secret: Buffer } | { readonly kid: string; readonly secret: Buffer; readonly demotedAtSeconds: number; readonly verificationCutoffSeconds: number }): key is { readonly kid: string; readonly secret: Buffer; readonly demotedAtSeconds: number; readonly verificationCutoffSeconds: number } {
  return 'demotedAtSeconds' in key;
}

export function internalPrincipalRequestHash(query: string, body: string): { queryHash: string; bodyHash: string } {
  return { queryHash: sha256(normalizedQuery(query)), bodyHash: sha256(body) };
}
