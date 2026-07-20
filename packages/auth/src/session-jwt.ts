import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  SANGFOR_JWT_ALGORITHM,
  SANGFOR_JWT_AUDIENCE,
  SANGFOR_JWT_CLAIMS_VERSION,
  SANGFOR_JWT_ISSUER,
  SANGFOR_JWT_TYPE,
  getUserJwtConfig,
  type UserJwtConfig,
} from '@sangfor/config';

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

// `role` is @sangfor/web's own coarse session tier (admin|operator|viewer),
// a pre-existing concept distinct from the BusinessRole/permission system
// (packages/auth's AuthContext.businessRole, resolved from the DB in U015).
// It rides in the canonical envelope only because @sangfor/web's own
// downstream code (api-auth.ts) needs it back on verify without a second,
// parallel token format — API bearer verification (apps/api's authMiddleware)
// never reads it, so it grants no cross-service authority. It is never
// authoritative for BusinessRole/permissions.
export type WebSessionRole = 'admin' | 'operator' | 'viewer';

export interface SessionJwtClaims {
  readonly iss: typeof SANGFOR_JWT_ISSUER;
  readonly aud: typeof SANGFOR_JWT_AUDIENCE;
  readonly ver: typeof SANGFOR_JWT_CLAIMS_VERSION;
  readonly sub: string;
  readonly jti: string;
  readonly iat: number;
  readonly exp: number;
  readonly nbf: number;
  readonly tenantId?: string;
  readonly companyId?: string;
  readonly projectId?: string;
  readonly projectSlug?: string;
  readonly personaId?: string;
  readonly product?: string;
  readonly role?: WebSessionRole;
}

export interface SignSessionJwtInput {
  readonly sub: string;
  readonly jti?: string;
  readonly tenantId?: string;
  readonly companyId?: string;
  readonly projectId?: string;
  readonly projectSlug?: string;
  readonly personaId?: string;
  readonly product?: string;
  readonly role?: WebSessionRole;
  readonly nowSeconds?: number;
}

export interface ProtectedHeader {
  readonly alg: typeof SANGFOR_JWT_ALGORITHM;
  readonly kid: string;
  readonly typ: typeof SANGFOR_JWT_TYPE;
}

const ProtectedHeaderSchema = z
  .object({
    alg: z.literal(SANGFOR_JWT_ALGORITHM),
    kid: z.string().min(1),
    typ: z.literal(SANGFOR_JWT_TYPE),
  })
  .strict();

const ClaimsSchema = z
  .object({
    iss: z.literal(SANGFOR_JWT_ISSUER),
    aud: z.literal(SANGFOR_JWT_AUDIENCE),
    ver: z.literal(SANGFOR_JWT_CLAIMS_VERSION),
    sub: z.string().min(1),
    jti: z.string().min(1),
    iat: z.number().int(),
    exp: z.number().int(),
    nbf: z.number().int(),
    tenantId: z.string().min(1).optional(),
    companyId: z.string().min(1).optional(),
    projectId: z.string().min(1).optional(),
    projectSlug: z.string().min(1).optional(),
    personaId: z.string().min(1).optional(),
    product: z.string().min(1).optional(),
    role: z.enum(['admin', 'operator', 'viewer']).optional(),
  })
  .strict();

export type ResolvedKeyState = 'active' | 'verify_only';

export interface ResolvedVerificationKey {
  readonly kid: string;
  readonly state: ResolvedKeyState;
  readonly secret: Buffer;
  readonly activatedAtSeconds: number;
  readonly demotedAtSeconds?: number;
  readonly verifyUntilSeconds?: number;
}

/**
 * Selects the exact key material for a header `kid` per the rotation
 * state machine: retired kids never verify (checked first, unconditionally),
 * the active kid signs/verifies unrestricted, and a verify_only kid is
 * eligible only strictly through its own `verifyUntil` cutoff.
 */
export function resolveVerificationKey(
  kid: string,
  config: UserJwtConfig,
  nowSeconds: number,
): ResolvedVerificationKey | null {
  if (config.retiredKids.has(kid)) return null;
  if (kid === config.activeKid) {
    return {
      kid: config.active.kid,
      state: 'active',
      secret: config.active.secret,
      activatedAtSeconds: config.active.activatedAtSeconds,
    };
  }
  const verifyOnly = config.verifyOnly.get(kid);
  if (!verifyOnly) return null;
  if (nowSeconds > verifyOnly.verifyUntilSeconds) return null;
  return {
    kid: verifyOnly.kid,
    state: 'verify_only',
    secret: verifyOnly.secret,
    activatedAtSeconds: verifyOnly.activatedAtSeconds,
    demotedAtSeconds: verifyOnly.demotedAtSeconds,
    verifyUntilSeconds: verifyOnly.verifyUntilSeconds,
  };
}

function base64UrlEncode(input: Buffer): string {
  return input.toString('base64url');
}

function base64UrlDecodeCanonical(segment: string): Buffer | null {
  if (segment.length === 0 || !BASE64URL_SEGMENT.test(segment)) return null;
  let buf: Buffer;
  try {
    buf = Buffer.from(segment, 'base64url');
  } catch {
    return null;
  }
  if (buf.toString('base64url') !== segment) return null;
  return buf;
}

/**
 * Rejects duplicate top-level JSON object keys that `JSON.parse` would
 * otherwise silently resolve to last-value-wins, hiding a smuggled claim
 * (e.g. two `businessRole` keys, verifier reads one, signer wrote another).
 * Scoped to this contract's flat, single-level header/payload objects.
 */
function hasNoDuplicateTopLevelKeys(jsonText: string): boolean {
  const seen = new Set<string>();
  let depth = 0;
  let i = 0;
  while (i < jsonText.length) {
    const ch = jsonText[i];
    if (ch === '"') {
      const start = i;
      i += 1;
      while (i < jsonText.length && jsonText[i] !== '"') {
        i += jsonText[i] === '\\' ? 2 : 1;
      }
      i += 1;
      const literal = jsonText.slice(start, i);
      if (depth === 1) {
        let k = i;
        while (k < jsonText.length && /\s/.test(jsonText[k])) k += 1;
        if (jsonText[k] === ':') {
          let key: string;
          try {
            key = JSON.parse(literal);
          } catch {
            return false;
          }
          if (seen.has(key)) return false;
          seen.add(key);
        }
      }
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    i += 1;
  }
  return true;
}

/**
 * Shared low-level HS256 compact-JWT primitives. Exported so any caller
 * that needs a payload shape beyond the strict canonical `SessionJwtClaims`
 * (e.g. `TokenManager`'s product-scoped tokens) still goes through the same
 * node:crypto engine, base64url canonicalization, duplicate-key rejection,
 * and rotation-aware key selection as the session contract — never a
 * second, independently-maintained crypto implementation.
 */
export function encodeJsonSegment(value: unknown): string {
  return base64UrlEncode(Buffer.from(JSON.stringify(value), 'utf8'));
}

export function encodeBytesSegment(bytes: Buffer): string {
  return base64UrlEncode(bytes);
}

export function decodeJsonSegment(segment: string): { ok: true; text: string; value: unknown } | { ok: false } {
  const buf = base64UrlDecodeCanonical(segment);
  if (!buf) return { ok: false };
  const text = buf.toString('utf8');
  if (!hasNoDuplicateTopLevelKeys(text)) return { ok: false };
  try {
    return { ok: true, text, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

export function computeHmacSignature(secret: Buffer, signingInput: string): Buffer {
  return createHmac('sha256', secret).update(signingInput, 'utf8').digest();
}

export function verifySignatureSegment(secret: Buffer, signingInput: string, signatureSegment: string): boolean {
  const provided = base64UrlDecodeCanonical(signatureSegment);
  if (!provided) return false;
  const expected = computeHmacSignature(secret, signingInput);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function buildProtectedHeader(kid: string): ProtectedHeader {
  return { alg: SANGFOR_JWT_ALGORITHM, kid, typ: SANGFOR_JWT_TYPE };
}

/**
 * Decodes + validates a protected-header segment against the one pinned
 * shape/algorithm this contract ever accepts. Never dispatches on
 * `header.alg` — it is only ever compared for equality against the single
 * supported value.
 */
export function parseProtectedHeaderSegment(segment: string): ProtectedHeader | null {
  const decoded = decodeJsonSegment(segment);
  if (!decoded.ok) return null;
  const result = ProtectedHeaderSchema.safeParse(decoded.value);
  if (!result.success) return null;
  if (result.data.alg !== SANGFOR_JWT_ALGORITHM) return null;
  return result.data;
}

/**
 * Signs the canonical session claims envelope with the configured active
 * key only — a verify_only/retired key can never reach this signer because
 * `UserJwtConfig.active` is typed and parsed to hold exclusively the single
 * active entry (see packages/config/src/user-jwt.ts).
 */
export function signSessionJwt(input: SignSessionJwtInput, config: UserJwtConfig = getUserJwtConfig()): string {
  const sub = input.sub?.trim();
  if (!sub) throw new Error('signSessionJwt: sub is required');
  const jti = input.jti?.trim() || randomUUID();
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  const claims: SessionJwtClaims = {
    iss: SANGFOR_JWT_ISSUER,
    aud: SANGFOR_JWT_AUDIENCE,
    ver: SANGFOR_JWT_CLAIMS_VERSION,
    sub,
    jti,
    iat: now,
    exp: now + config.ttlSeconds,
    nbf: now,
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    ...(input.companyId ? { companyId: input.companyId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.projectSlug ? { projectSlug: input.projectSlug } : {}),
    ...(input.personaId ? { personaId: input.personaId } : {}),
    ...(input.product ? { product: input.product } : {}),
    ...(input.role ? { role: input.role } : {}),
  };

  const headerSegment = encodeJsonSegment(buildProtectedHeader(config.activeKid));
  const payloadSegment = encodeJsonSegment(claims);
  const signingInput = `${headerSegment}.${payloadSegment}`;
  const signatureSegment = encodeBytesSegment(computeHmacSignature(config.active.secret, signingInput));
  return `${signingInput}.${signatureSegment}`;
}

/**
 * Verifies a compact JWT against the unified session contract. Fails closed
 * (returns `null`) on any structural, cryptographic, or business-rule
 * deviation — never throws for attacker-controlled input, and never selects
 * verification behavior from the token's own `alg` header beyond the single
 * pinned-equality check below.
 */
export function verifySessionJwt(
  token: string,
  config: UserJwtConfig = getUserJwtConfig(),
  nowSeconds: number = Math.floor(Date.now() / 1000),
): SessionJwtClaims | null {
  if (typeof token !== 'string' || token.length === 0) return null;
  const segments = token.split('.');
  if (segments.length !== 3) return null;
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (!headerSegment || !payloadSegment || !signatureSegment) return null;
  if (
    !BASE64URL_SEGMENT.test(headerSegment) ||
    !BASE64URL_SEGMENT.test(payloadSegment) ||
    !BASE64URL_SEGMENT.test(signatureSegment)
  ) {
    return null;
  }

  const header = parseProtectedHeaderSegment(headerSegment);
  if (!header) return null;

  const key = resolveVerificationKey(header.kid, config, nowSeconds);
  if (!key) return null;

  const signingInput = `${headerSegment}.${payloadSegment}`;
  if (!verifySignatureSegment(key.secret, signingInput, signatureSegment)) return null;

  const decodedPayload = decodeJsonSegment(payloadSegment);
  if (!decodedPayload.ok) return null;
  const claimsResult = ClaimsSchema.safeParse(decodedPayload.value);
  if (!claimsResult.success) return null;
  const claims = claimsResult.data;

  if (claims.iss !== config.issuer) return null;
  if (claims.aud !== config.audience) return null;
  if (claims.ver !== config.claimsVersion) return null;
  if (claims.exp !== claims.iat + config.ttlSeconds) return null;
  if (claims.nbf < claims.iat || claims.nbf > claims.exp) return null;
  if (claims.iat < key.activatedAtSeconds) return null;
  if (nowSeconds + config.clockSkewSeconds < claims.nbf) return null;
  if (nowSeconds > claims.exp + config.clockSkewSeconds) return null;

  if (key.state === 'verify_only') {
    if (claims.iat >= (key.demotedAtSeconds as number)) return null;
    if (claims.exp > (key.demotedAtSeconds as number) + config.ttlSeconds) return null;
  }

  return claims;
}
