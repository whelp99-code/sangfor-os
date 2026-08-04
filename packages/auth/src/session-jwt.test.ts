import { createHmac } from 'node:crypto';
import {
  SANGFOR_JWT_ALGORITHM,
  SANGFOR_JWT_AUDIENCE,
  SANGFOR_JWT_CLAIMS_VERSION,
  SANGFOR_JWT_ISSUER,
  SANGFOR_JWT_TYPE,
  USER_JWT_KEYRING_VERSION,
  parseUserJwtConfig,
  type ParseUserJwtConfigEnv,
  type UserJwtConfig,
  type UserJwtKeyringEntry,
} from '@sangfor/config';
import { describe, expect, it } from 'vitest';
import { buildProtectedHeader, resolveVerificationKey, signSessionJwt, verifySessionJwt } from './session-jwt';

const D = 1_700_000_000;
const VERIFY_UNTIL = D + 28_800 + 30;

function secretOfLength(bytes: number, fill = 7): string {
  return Buffer.alloc(bytes, fill).toString('base64url');
}

function rfc3339(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const ACTIVE_SECRET_BYTES = Buffer.alloc(32, 7);
const VERIFY_SECRET_BYTES = Buffer.alloc(48, 9);

function activeEntry(overrides: Partial<UserJwtKeyringEntry> = {}): UserJwtKeyringEntry {
  return {
    kid: 'active-1',
    state: 'active',
    secretBase64Url: ACTIVE_SECRET_BYTES.toString('base64url'),
    activatedAt: rfc3339(D - 10_000),
    demotedAt: null,
    verifyUntil: null,
    retiredAt: null,
    ...overrides,
  };
}

function verifyOnlyEntry(overrides: Partial<UserJwtKeyringEntry> = {}): UserJwtKeyringEntry {
  return {
    kid: 'verify-1',
    state: 'verify_only',
    secretBase64Url: VERIFY_SECRET_BYTES.toString('base64url'),
    activatedAt: rfc3339(D - 20_000),
    demotedAt: rfc3339(D),
    verifyUntil: rfc3339(VERIFY_UNTIL),
    retiredAt: null,
    ...overrides,
  };
}

function retiredEntry(overrides: Partial<UserJwtKeyringEntry> = {}): UserJwtKeyringEntry {
  return {
    kid: 'retired-1',
    state: 'retired',
    secretBase64Url: null,
    activatedAt: rfc3339(D - 40_000),
    demotedAt: rfc3339(D - 30_000),
    verifyUntil: rfc3339(D - 30_000 + 930),
    retiredAt: rfc3339(D - 29_999),
    ...overrides,
  };
}

function buildConfig(keys: UserJwtKeyringEntry[], parseNow = D - 1, envOverrides: Partial<ParseUserJwtConfigEnv> = {}): UserJwtConfig {
  const env: ParseUserJwtConfigEnv = {
    USER_JWT_ACTIVE_KID: 'active-1',
    USER_JWT_ROTATION_OWNER: 'security-auth',
    USER_JWT_ISSUER: SANGFOR_JWT_ISSUER,
    USER_JWT_AUDIENCE: SANGFOR_JWT_AUDIENCE,
    USER_JWT_TTL_SECONDS: '28800',
    USER_JWT_CLOCK_SKEW_SECONDS: '30',
    USER_JWT_KEYRING_JSON: JSON.stringify({ version: USER_JWT_KEYRING_VERSION, keys }),
    ...envOverrides,
  };
  return parseUserJwtConfig(env, parseNow);
}

const activeOnlyConfig = buildConfig([activeEntry()], D - 1);

function b64url(input: Buffer | string): string {
  return (typeof input === 'string' ? Buffer.from(input, 'utf8') : input).toString('base64url');
}

function hmac(secret: Buffer, data: string): Buffer {
  return createHmac('sha256', secret).update(data, 'utf8').digest();
}

function craftFromRawSegments(headerRawJson: string, payloadRawJson: string, secret: Buffer): string {
  const h = b64url(headerRawJson);
  const p = b64url(payloadRawJson);
  const sig = b64url(hmac(secret, `${h}.${p}`));
  return `${h}.${p}.${sig}`;
}

function craftToken(header: unknown, payload: unknown, secret: Buffer): string {
  return craftFromRawSegments(JSON.stringify(header), JSON.stringify(payload), secret);
}

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: SANGFOR_JWT_ISSUER,
    aud: SANGFOR_JWT_AUDIENCE,
    ver: SANGFOR_JWT_CLAIMS_VERSION,
    sub: 'user-1',
    jti: 'jti-1',
    iat: D - 100,
    exp: D - 100 + 28_800,
    nbf: D - 100,
    ...overrides,
  };
}

describe('signSessionJwt', () => {
  it('produces a canonical 3-segment compact JWT with the exact protected header', () => {
    const token = signSessionJwt({ sub: 'user-1' }, activeOnlyConfig);
    const [h] = token.split('.');
    expect(token.split('.')).toHaveLength(3);
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    expect(header).toEqual({ alg: 'HS256', kid: 'active-1', typ: 'JWT' });
  });

  it('always signs with the active key and emits its kid, never a verify_only kid', () => {
    const cfg = buildConfig([activeEntry(), verifyOnlyEntry()], D - 1);
    const token = signSessionJwt({ sub: 'user-1' }, cfg);
    const [h] = token.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString('utf8'));
    expect(header.kid).toBe(cfg.activeKid);
    expect(header.kid).not.toBe('verify-1');
  });

  it('generates a non-empty unique jti when none is supplied', () => {
    const a = signSessionJwt({ sub: 'user-1' }, activeOnlyConfig);
    const b = signSessionJwt({ sub: 'user-1' }, activeOnlyConfig);
    const claimsOf = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString('utf8'));
    expect(claimsOf(a).jti).not.toBe(claimsOf(b).jti);
    expect(claimsOf(a).jti.length).toBeGreaterThan(0);
  });

  it('sets exp = iat + 28_800 and rejects a blank sub', () => {
    const token = signSessionJwt({ sub: 'user-1', nowSeconds: D }, activeOnlyConfig);
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(claims.iat).toBe(D);
    expect(claims.exp).toBe(D + 28_800);
    expect(() => signSessionJwt({ sub: '  ' }, activeOnlyConfig)).toThrow();
  });

  it('round-trips through verifySessionJwt with identity/scope claims only', () => {
    const token = signSessionJwt(
      { sub: 'user-1', tenantId: 't1', companyId: 'c1', projectId: 'p1', projectSlug: 'demo', personaId: 'persona-1', product: 'portal', nowSeconds: D },
      activeOnlyConfig,
    );
    const claims = verifySessionJwt(token, activeOnlyConfig, D + 1);
    expect(claims).toMatchObject({ sub: 'user-1', tenantId: 't1', companyId: 'c1', projectId: 'p1', projectSlug: 'demo', personaId: 'persona-1', product: 'portal' });
  });
});

describe('verifySessionJwt — protected header', () => {
  it('accepts the exact {alg,kid,typ} header shape', () => {
    const token = signSessionJwt({ sub: 'u', nowSeconds: D }, activeOnlyConfig);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).not.toBeNull();
  });

  it('rejects alg=none', () => {
    const token = craftToken({ alg: 'none', kid: 'active-1', typ: 'JWT' }, validClaims({ iat: D, exp: D + 28_800, nbf: D }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects alg=HS384', () => {
    const token = craftToken({ alg: 'HS384', kid: 'active-1', typ: 'JWT' }, validClaims({ iat: D, exp: D + 28_800, nbf: D }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a missing header field', () => {
    const token = craftFromRawSegments(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      JSON.stringify(validClaims({ iat: D, exp: D + 28_800, nbf: D })),
      ACTIVE_SECRET_BYTES,
    );
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects an extra header field (crit)', () => {
    const token = craftToken({ alg: 'HS256', kid: 'active-1', typ: 'JWT', crit: ['b64'] }, validClaims({ iat: D, exp: D + 28_800, nbf: D }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a remote-key header (jku)', () => {
    const token = craftToken(
      { alg: 'HS256', kid: 'active-1', typ: 'JWT', jku: 'https://evil.example/keys.json' },
      validClaims({ iat: D, exp: D + 28_800, nbf: D }),
      ACTIVE_SECRET_BYTES,
    );
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects duplicate JSON keys in the header', () => {
    const headerRaw = '{"alg":"HS256","kid":"active-1","typ":"JWT","alg":"none"}';
    const token = craftFromRawSegments(headerRaw, JSON.stringify(validClaims({ iat: D, exp: D + 28_800, nbf: D })), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects duplicate JSON keys in the payload', () => {
    const payloadRaw = JSON.stringify(validClaims({ iat: D, exp: D + 28_800, nbf: D })).replace('"sub":"user-1"', '"sub":"user-1","sub":"attacker"');
    const token = craftFromRawSegments(JSON.stringify({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }), payloadRaw, ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects padded base64 segments', () => {
    const token = signSessionJwt({ sub: 'u', nowSeconds: D }, activeOnlyConfig);
    const [h, p, s] = token.split('.');
    expect(verifySessionJwt(`${h}==.${p}.${s}`, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a non-canonical two-segment legacy token', () => {
    const token = signSessionJwt({ sub: 'u', nowSeconds: D }, activeOnlyConfig);
    const [h, p] = token.split('.');
    expect(verifySessionJwt(`${h}.${p}`, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a four-segment token', () => {
    const token = signSessionJwt({ sub: 'u', nowSeconds: D }, activeOnlyConfig);
    expect(verifySessionJwt(`${token}.extra`, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects the legacy mock token string', () => {
    expect(verifySessionJwt('mock.session', activeOnlyConfig, D + 1)).toBeNull();
  });
});

describe('verifySessionJwt — kid selection', () => {
  it('rejects a missing kid', () => {
    const token = craftFromRawSegments(
      JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
      JSON.stringify(validClaims({ iat: D, exp: D + 28_800, nbf: D })),
      ACTIVE_SECRET_BYTES,
    );
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects an unknown kid', () => {
    const token = craftToken({ alg: 'HS256', kid: 'unknown-kid', typ: 'JWT' }, validClaims({ iat: D, exp: D + 28_800, nbf: D }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a retired kid even with the correct historical secret', () => {
    const cfg = buildConfig([activeEntry(), retiredEntry()], D - 1);
    const token = craftToken({ alg: 'HS256', kid: 'retired-1', typ: 'JWT' }, validClaims({ iat: D - 39_000, exp: D - 39_000 + 28_800, nbf: D - 39_000 }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, cfg, D - 1)).toBeNull();
  });

  it('resolveVerificationKey never returns a retired key', () => {
    const cfg = buildConfig([activeEntry(), retiredEntry()], D - 1);
    expect(resolveVerificationKey('retired-1', cfg, D - 40_000)).toBeNull();
  });
});

describe('verifySessionJwt — claims pinning', () => {
  it('rejects a wrong issuer', () => {
    const token = craftToken({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }, validClaims({ iss: 'evil-issuer', iat: D, exp: D + 28_800, nbf: D }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a wrong audience', () => {
    const token = craftToken({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }, validClaims({ aud: 'evil-audience', iat: D, exp: D + 28_800, nbf: D }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a wrong claims version', () => {
    const token = craftToken({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }, validClaims({ ver: 'sangfor.user-session/v0', iat: D, exp: D + 28_800, nbf: D }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a wrong ttl (exp != iat + 28_800)', () => {
    const token = craftToken({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }, validClaims({ iat: D, exp: D + 28_801, nbf: D }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a token accepted only past the allowed clock skew', () => {
    const token = craftToken({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }, validClaims({ iat: D, exp: D + 28_800, nbf: D }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 28_800 + 31)).toBeNull();
    expect(verifySessionJwt(token, activeOnlyConfig, D + 28_800 + 30)).not.toBeNull();
  });

  it('rejects a missing jti', () => {
    const raw = JSON.stringify(validClaims({ iat: D, exp: D + 28_800, nbf: D })).replace(/,"jti":"jti-1"/, '');
    const token = craftFromRawSegments(JSON.stringify({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }), raw, ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a blank jti', () => {
    const token = craftToken({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }, validClaims({ jti: '', iat: D, exp: D + 28_800, nbf: D }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a missing sub', () => {
    const raw = JSON.stringify(validClaims({ iat: D, exp: D + 28_800, nbf: D })).replace(/"sub":"user-1",/, '');
    const token = craftFromRawSegments(JSON.stringify({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }), raw, ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = craftToken({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }, validClaims({ iat: D - 1000, exp: D - 100, nbf: D - 1000 }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D)).toBeNull();
  });

  it('rejects a not-yet-valid (future nbf) token', () => {
    const token = craftToken({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }, validClaims({ iat: D, exp: D + 28_800, nbf: D + 500 }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 10)).toBeNull();
    expect(verifySessionJwt(token, activeOnlyConfig, D + 500)).not.toBeNull();
  });

  it('rejects nbf outside [iat, exp]', () => {
    const token = craftToken({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }, validClaims({ iat: D, exp: D + 28_800, nbf: D + 28_801 }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 28_801)).toBeNull();
  });

  it('rejects iat before the signing key was activated', () => {
    const cfg = buildConfig([activeEntry({ activatedAt: rfc3339(D + 100) })], D + 99);
    const token = craftToken({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }, validClaims({ iat: D, exp: D + 28_800, nbf: D }), ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, cfg, D + 200)).toBeNull();
  });

  it('rejects a tampered payload (signature mismatch)', () => {
    const token = signSessionJwt({ sub: 'user-1', nowSeconds: D }, activeOnlyConfig);
    const [h, , s] = token.split('.');
    const tamperedPayload = b64url(JSON.stringify({ ...validClaims({ iat: D, exp: D + 28_800, nbf: D }), sub: 'attacker' }));
    expect(verifySessionJwt(`${h}.${tamperedPayload}.${s}`, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const token = signSessionJwt({ sub: 'user-1', nowSeconds: D }, activeOnlyConfig);
    const [h, p, s] = token.split('.');
    const flipped = s.slice(0, -1) + (s.at(-1) === 'A' ? 'B' : 'A');
    expect(verifySessionJwt(`${h}.${p}.${flipped}`, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a legacy BusinessRole claim forged into the payload (extra field, strict schema — never authoritative)', () => {
    const raw = JSON.stringify({ ...validClaims({ iat: D, exp: D + 28_800, nbf: D }), businessRole: 'system_admin' });
    const token = craftFromRawSegments(JSON.stringify({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }), raw, ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects an unrecognized role value (schema-pinned enum)', () => {
    const raw = JSON.stringify({ ...validClaims({ iat: D, exp: D + 28_800, nbf: D }), role: 'superadmin' });
    const token = craftFromRawSegments(JSON.stringify({ alg: 'HS256', kid: 'active-1', typ: 'JWT' }), raw, ACTIVE_SECRET_BYTES);
    expect(verifySessionJwt(token, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('rejects a role escalated by an attacker without the signing key (role claim forgery)', () => {
    const token = signSessionJwt({ sub: 'user-1', role: 'viewer', nowSeconds: D }, activeOnlyConfig);
    const [h, p, s] = token.split('.');
    const escalatedPayload = b64url(
      JSON.stringify({ ...validClaims({ iat: D, exp: D + 28_800, nbf: D }), role: 'admin' }),
    );
    // Same signature as the legitimately-issued viewer token — an attacker who
    // cannot recompute a valid signature over the escalated payload.
    expect(verifySessionJwt(`${h}.${escalatedPayload}.${s}`, activeOnlyConfig, D + 1)).toBeNull();
  });

  it('round-trips a genuinely signed, non-authoritative web session role', () => {
    const token = signSessionJwt({ sub: 'user-1', role: 'admin', nowSeconds: D }, activeOnlyConfig);
    const claims = verifySessionJwt(token, activeOnlyConfig, D + 1);
    expect(claims?.role).toBe('admin');
  });
});

describe('rotation — active -> verify_only -> secret-free retired', () => {
  it('verifies a token issued by the old key strictly before demotion, using the demoted verify_only entry', () => {
    const cfg = buildConfig([activeEntry({ kid: 'active-2', secretBase64Url: secretOfLength(32, 3) }), verifyOnlyEntry()], D + 1, { USER_JWT_ACTIVE_KID: 'active-2' });
    const preRotationToken = craftToken(
      { alg: 'HS256', kid: 'verify-1', typ: 'JWT' },
      validClaims({ iat: D - 500, exp: D - 500 + 28_800, nbf: D - 500 }),
      VERIFY_SECRET_BYTES,
    );
    expect(verifySessionJwt(preRotationToken, cfg, D + 5)).not.toBeNull();
  });

  it('rejects a token issued by the verify_only key after its own demotion instant (iat >= D)', () => {
    const cfg = buildConfig([activeEntry({ kid: 'active-2', secretBase64Url: secretOfLength(32, 3) }), verifyOnlyEntry()], D + 1, { USER_JWT_ACTIVE_KID: 'active-2' });
    const postDemotionToken = craftToken(
      { alg: 'HS256', kid: 'verify-1', typ: 'JWT' },
      validClaims({ iat: D, exp: D + 28_800, nbf: D }),
      VERIFY_SECRET_BYTES,
    );
    expect(verifySessionJwt(postDemotionToken, cfg, D + 5)).toBeNull();
  });

  it('rejects a verify_only token whose exp extends past the D+28800 cutoff', () => {
    const cfg = buildConfig([activeEntry({ kid: 'active-2', secretBase64Url: secretOfLength(32, 3) }), verifyOnlyEntry()], D + 1, { USER_JWT_ACTIVE_KID: 'active-2' });
    // exp inflated past iat+900 (and past D+28800) — caught by ttl pinning, which
    // is exactly what makes exp<=D+28800 an automatic consequence of iat<D here.
    const overhangToken = craftToken(
      { alg: 'HS256', kid: 'verify-1', typ: 'JWT' },
      validClaims({ iat: D - 1, exp: D + 28_801, nbf: D - 1 }),
      VERIFY_SECRET_BYTES,
    );
    expect(verifySessionJwt(overhangToken, cfg, D + 5)).toBeNull();
  });

  it('rejects verification once the verifier clock passes D+28830 (verify after cutoff)', () => {
    const cfg = buildConfig([activeEntry({ kid: 'active-2', secretBase64Url: secretOfLength(32, 3) }), verifyOnlyEntry()], D + 1, { USER_JWT_ACTIVE_KID: 'active-2' });
    const preRotationToken = craftToken(
      { alg: 'HS256', kid: 'verify-1', typ: 'JWT' },
      validClaims({ iat: D - 500, exp: D - 500 + 28_800, nbf: D - 500 }),
      VERIFY_SECRET_BYTES,
    );
    expect(verifySessionJwt(preRotationToken, cfg, D + 400)).not.toBeNull();
    // The key-selection cutoff itself (independent of any single token's own
    // exp+skew, which is always at least a second tighter than D+28830 given
    // the strict iat<D rule): resolvable at/through D+28830, gone just after.
    expect(resolveVerificationKey('verify-1', cfg, VERIFY_UNTIL)).not.toBeNull();
    expect(resolveVerificationKey('verify-1', cfg, VERIFY_UNTIL + 1)).toBeNull();
  });

  it('a secret-free retired tombstone never verifies, at any time', () => {
    const cfg = buildConfig([activeEntry(), retiredEntry()], D - 1);
    expect(cfg.retiredKids.has('retired-1')).toBe(true);
    const forged = craftToken(
      { alg: 'HS256', kid: 'retired-1', typ: 'JWT' },
      validClaims({ iat: D - 39_500, exp: D - 39_500 + 28_800, nbf: D - 39_500 }),
      ACTIVE_SECRET_BYTES,
    );
    expect(verifySessionJwt(forged, cfg, D - 39_000)).toBeNull();
  });

  it('overdue verify_only config is a startup error surfaced by parseUserJwtConfig, not a silent accept', () => {
    expect(() => buildConfig([activeEntry(), verifyOnlyEntry()], VERIFY_UNTIL + 1)).toThrow();
  });
});

describe('buildProtectedHeader', () => {
  it('returns the exact three-field shape', () => {
    expect(buildProtectedHeader('k1')).toEqual({ alg: SANGFOR_JWT_ALGORITHM, kid: 'k1', typ: SANGFOR_JWT_TYPE });
  });
});
