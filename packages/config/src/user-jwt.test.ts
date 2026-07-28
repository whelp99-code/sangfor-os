import { describe, expect, it } from 'vitest';
import {
  KID_PATTERN,
  SANGFOR_JWT_AUDIENCE,
  SANGFOR_JWT_ALGORITHM,
  SANGFOR_JWT_CLAIMS_VERSION,
  SANGFOR_JWT_CLOCK_SKEW_SECONDS,
  SANGFOR_JWT_ISSUER,
  SANGFOR_JWT_TTL_SECONDS,
  SANGFOR_JWT_TYPE,
  USER_JWT_KEYRING_VERSION,
  USER_JWT_ROTATION_OWNER_EXPECTED,
  UserJwtConfigError,
  parseUserJwtConfig,
  type ParseUserJwtConfigEnv,
  type UserJwtKeyringEntry,
} from './user-jwt';

const D = 1_700_000_000;
const VERIFY_UNTIL = D + 900 + 30;

function secretOfLength(bytes: number): string {
  return Buffer.alloc(bytes, 7).toString('base64url');
}

function rfc3339(seconds: number): string {
  return new Date(seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const ACTIVE_SECRET = secretOfLength(32);
const VERIFY_SECRET = secretOfLength(48);

function activeEntry(overrides: Partial<UserJwtKeyringEntry> = {}): UserJwtKeyringEntry {
  return {
    kid: 'active-1',
    state: 'active',
    secretBase64Url: ACTIVE_SECRET,
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
    secretBase64Url: VERIFY_SECRET,
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

function baseEnv(overrides: Partial<ParseUserJwtConfigEnv> = {}, keys: UserJwtKeyringEntry[] = [activeEntry()]): ParseUserJwtConfigEnv {
  return {
    USER_JWT_ACTIVE_KID: 'active-1',
    USER_JWT_ROTATION_OWNER: 'security-auth',
    USER_JWT_ISSUER: SANGFOR_JWT_ISSUER,
    USER_JWT_AUDIENCE: SANGFOR_JWT_AUDIENCE,
    USER_JWT_TTL_SECONDS: String(SANGFOR_JWT_TTL_SECONDS),
    USER_JWT_CLOCK_SKEW_SECONDS: String(SANGFOR_JWT_CLOCK_SKEW_SECONDS),
    USER_JWT_KEYRING_JSON: JSON.stringify({ version: USER_JWT_KEYRING_VERSION, keys }),
    ...overrides,
  };
}

function expectFail(env: ParseUserJwtConfigEnv, now = D - 1) {
  expect(() => parseUserJwtConfig(env, now)).toThrow(UserJwtConfigError);
}

describe('constants', () => {
  it('byte-match the exact contract values', () => {
    expect(SANGFOR_JWT_ISSUER).toBe('sangfor-os');
    expect(SANGFOR_JWT_AUDIENCE).toBe('sangfor-os-runtime');
    expect(SANGFOR_JWT_ALGORITHM).toBe('HS256');
    expect(SANGFOR_JWT_TYPE).toBe('JWT');
    expect(SANGFOR_JWT_CLAIMS_VERSION).toBe('sangfor.user-session/v1');
    expect(SANGFOR_JWT_TTL_SECONDS).toBe(900);
    expect(SANGFOR_JWT_CLOCK_SKEW_SECONDS).toBe(30);
    expect(USER_JWT_KEYRING_VERSION).toBe('sangfor.user-jwt-keyring/v1');
    expect(USER_JWT_ROTATION_OWNER_EXPECTED).toBe('security-auth');
  });

  it('kid pattern accepts/rejects per spec', () => {
    expect(KID_PATTERN.test('k1')).toBe(true);
    expect(KID_PATTERN.test('a'.repeat(64))).toBe(true);
    expect(KID_PATTERN.test('a'.repeat(65))).toBe(false);
    expect(KID_PATTERN.test('-leading-dash')).toBe(false);
    expect(KID_PATTERN.test('has space')).toBe(false);
  });
});

describe('parseUserJwtConfig — happy path', () => {
  it('parses a minimal single-active keyring', () => {
    const cfg = parseUserJwtConfig(baseEnv(), D - 1);
    expect(cfg.activeKid).toBe('active-1');
    expect(cfg.active.secret.length).toBe(32);
    expect(cfg.issuer).toBe(SANGFOR_JWT_ISSUER);
    expect(cfg.audience).toBe(SANGFOR_JWT_AUDIENCE);
    expect(cfg.rotationOwner).toBe('security-auth');
    expect(cfg.verifyOnly.size).toBe(0);
    expect(cfg.retiredKids.size).toBe(0);
  });

  it('parses active + verify_only + retired together', () => {
    const cfg = parseUserJwtConfig(baseEnv({}, [activeEntry(), verifyOnlyEntry(), retiredEntry()]), D + 10);
    expect(cfg.activeKid).toBe('active-1');
    expect(cfg.verifyOnly.has('verify-1')).toBe(true);
    expect(cfg.verifyOnly.get('verify-1')?.secret.length).toBe(48);
    expect(cfg.retiredKids.has('retired-1')).toBe(true);
  });

  it('accepts a 64-byte secret (upper bound)', () => {
    const cfg = parseUserJwtConfig(baseEnv({}, [activeEntry({ secretBase64Url: secretOfLength(64) })]), D - 1);
    expect(cfg.active.secret.length).toBe(64);
  });
});

describe('parseUserJwtConfig — env-level failures', () => {
  it('rejects missing USER_JWT_ACTIVE_KID', () => expectFail(baseEnv({ USER_JWT_ACTIVE_KID: '' })));
  it('rejects a malformed USER_JWT_ACTIVE_KID', () => expectFail(baseEnv({ USER_JWT_ACTIVE_KID: '-bad' })));
  it('rejects a wrong rotation owner', () => expectFail(baseEnv({ USER_JWT_ROTATION_OWNER: 'someone-else' })));
  it('rejects a missing rotation owner', () => expectFail(baseEnv({ USER_JWT_ROTATION_OWNER: '' })));
  it('rejects a case-mismatched issuer', () => expectFail(baseEnv({ USER_JWT_ISSUER: 'Sangfor-OS' })));
  it('rejects a wrong issuer', () => expectFail(baseEnv({ USER_JWT_ISSUER: 'other-issuer' })));
  it('rejects a wrong audience', () => expectFail(baseEnv({ USER_JWT_AUDIENCE: 'other-audience' })));
  it('rejects a wrong ttl', () => expectFail(baseEnv({ USER_JWT_TTL_SECONDS: '901' })));
  it('rejects a wrong skew', () => expectFail(baseEnv({ USER_JWT_CLOCK_SKEW_SECONDS: '31' })));
  it('rejects missing USER_JWT_KEYRING_JSON', () => expectFail(baseEnv({ USER_JWT_KEYRING_JSON: '' })));
  it('rejects invalid JSON', () => expectFail(baseEnv({ USER_JWT_KEYRING_JSON: '{not json' })));
  it('rejects a wrong keyring version', () =>
    expectFail(baseEnv({ USER_JWT_KEYRING_JSON: JSON.stringify({ version: 'wrong/v1', keys: [activeEntry()] }) })));
  it('rejects an extra top-level keyring field', () =>
    expectFail(
      baseEnv({
        USER_JWT_KEYRING_JSON: JSON.stringify({ version: USER_JWT_KEYRING_VERSION, keys: [activeEntry()], extra: 1 }),
      }),
    ));
  it('rejects a missing keyring field on an entry', () => {
    const bad = activeEntry() as unknown as Record<string, unknown>;
    delete bad.retiredAt;
    expectFail(baseEnv({ USER_JWT_KEYRING_JSON: JSON.stringify({ version: USER_JWT_KEYRING_VERSION, keys: [bad] }) }));
  });
  it('rejects an extra field on an entry', () => {
    const bad = { ...activeEntry(), extra: 'x' };
    expectFail(baseEnv({ USER_JWT_KEYRING_JSON: JSON.stringify({ version: USER_JWT_KEYRING_VERSION, keys: [bad] }) }));
  });
});

describe('parseUserJwtConfig — key-shape failures', () => {
  it('rejects a duplicate kid', () => expectFail(baseEnv({}, [activeEntry(), verifyOnlyEntry({ kid: 'active-1' })])));
  it('rejects a malformed kid on an entry', () => expectFail(baseEnv({}, [activeEntry({ kid: 'bad kid' })])));
  it('rejects multiple active keys', () =>
    expectFail(baseEnv({}, [activeEntry(), activeEntry({ kid: 'active-2', secretBase64Url: secretOfLength(32) })])));
  it('rejects zero active keys', () => expectFail(baseEnv({}, [verifyOnlyEntry()])));
  it('rejects USER_JWT_ACTIVE_KID not matching the keyring active kid', () =>
    expectFail(baseEnv({ USER_JWT_ACTIVE_KID: 'someone-else' }, [activeEntry()])));

  it('rejects an active entry with a non-null demotedAt', () =>
    expectFail(baseEnv({}, [activeEntry({ demotedAt: rfc3339(D) })])));
  it('rejects an active entry with a non-null verifyUntil', () =>
    expectFail(baseEnv({}, [activeEntry({ verifyUntil: rfc3339(D) })])));
  it('rejects an active entry with a non-null retiredAt', () =>
    expectFail(baseEnv({}, [activeEntry({ retiredAt: rfc3339(D) })])));
  it('rejects an active entry with a null secret', () => expectFail(baseEnv({}, [activeEntry({ secretBase64Url: null })])));

  it('rejects a secret shorter than 32 bytes', () => expectFail(baseEnv({}, [activeEntry({ secretBase64Url: secretOfLength(31) })])));
  it('rejects a secret longer than 64 bytes', () => expectFail(baseEnv({}, [activeEntry({ secretBase64Url: secretOfLength(65) })])));
  it('rejects a non-base64url secret', () => expectFail(baseEnv({}, [activeEntry({ secretBase64Url: 'not-base64!!' })])));
  it('rejects a padded base64 secret', () => expectFail(baseEnv({}, [activeEntry({ secretBase64Url: `${secretOfLength(32)}==` })])));

  it('rejects a verify_only entry with a null secret', () =>
    expectFail(baseEnv({}, [activeEntry(), verifyOnlyEntry({ secretBase64Url: null })])));
  it('rejects a verify_only entry with a null demotedAt', () =>
    expectFail(baseEnv({}, [activeEntry(), verifyOnlyEntry({ demotedAt: null })])));
  it('rejects a verify_only entry with a null verifyUntil', () =>
    expectFail(baseEnv({}, [activeEntry(), verifyOnlyEntry({ verifyUntil: null })])));
  it('rejects a verify_only entry with a non-null retiredAt', () =>
    expectFail(baseEnv({}, [activeEntry(), verifyOnlyEntry({ retiredAt: rfc3339(D) })])));
  it('rejects a verify_only entry with activatedAt >= demotedAt', () =>
    expectFail(baseEnv({}, [activeEntry(), verifyOnlyEntry({ activatedAt: rfc3339(D), demotedAt: rfc3339(D) })])));
  it('rejects a verify_only entry whose verifyUntil != demotedAt + 930', () =>
    expectFail(baseEnv({}, [activeEntry(), verifyOnlyEntry({ verifyUntil: rfc3339(D + 900) })])));
  it('rejects an overdue verify_only entry still present at startup (now > verifyUntil)', () =>
    expectFail(baseEnv({}, [activeEntry(), verifyOnlyEntry()]), VERIFY_UNTIL + 1));

  it('rejects a retired entry with a non-null secret', () =>
    expectFail(baseEnv({}, [activeEntry(), retiredEntry({ secretBase64Url: ACTIVE_SECRET })])));
  it('rejects a retired entry with a null demotedAt', () => expectFail(baseEnv({}, [activeEntry(), retiredEntry({ demotedAt: null })])));
  it('rejects a retired entry with a null retiredAt', () => expectFail(baseEnv({}, [activeEntry(), retiredEntry({ retiredAt: null })])));
  it('rejects a retired entry with a null verifyUntil', () => expectFail(baseEnv({}, [activeEntry(), retiredEntry({ verifyUntil: null })])));
  it('rejects a retired entry with impossible timestamp ordering (retiredAt < demotedAt)', () =>
    expectFail(
      baseEnv({}, [
        activeEntry(),
        retiredEntry({ demotedAt: rfc3339(D - 100), retiredAt: rfc3339(D - 200), verifyUntil: rfc3339(D - 100 + 930) }),
      ]),
    ));
  it('rejects a retired entry with impossible timestamp ordering (retiredAt > verifyUntil)', () =>
    expectFail(
      baseEnv({}, [
        activeEntry(),
        retiredEntry({ demotedAt: rfc3339(D - 100), retiredAt: rfc3339(D + 1000), verifyUntil: rfc3339(D - 100 + 930) }),
      ]),
    ));

  it('rejects a non-RFC3339 timestamp', () => expectFail(baseEnv({}, [activeEntry({ activatedAt: '2024-01-01' })])));
  it('rejects an unrecognized state value', () => {
    const bad = { ...activeEntry(), state: 'disabled' };
    expectFail(baseEnv({ USER_JWT_KEYRING_JSON: JSON.stringify({ version: USER_JWT_KEYRING_VERSION, keys: [bad] }) }));
  });
});

describe('parseUserJwtConfig — rotation D / D+900 / D+930 boundaries', () => {
  it('a verify_only key is present and usable strictly before its verifyUntil', () => {
    const cfg = parseUserJwtConfig(baseEnv({}, [activeEntry(), verifyOnlyEntry()]), VERIFY_UNTIL - 1);
    expect(cfg.verifyOnly.get('verify-1')?.verifyUntilSeconds).toBe(VERIFY_UNTIL);
  });

  it('a verify_only key is still accepted for parsing exactly at its verifyUntil second', () => {
    const cfg = parseUserJwtConfig(baseEnv({}, [activeEntry(), verifyOnlyEntry()]), VERIFY_UNTIL);
    expect(cfg.verifyOnly.has('verify-1')).toBe(true);
  });

  it('a verify_only key becomes a startup error the instant verifyUntil has passed', () =>
    expectFail(baseEnv({}, [activeEntry(), verifyOnlyEntry()]), VERIFY_UNTIL + 1));
});

describe('getUserJwtConfig', () => {
  it('is a distinct export reading process.env', async () => {
    const mod = await import('./user-jwt');
    expect(typeof mod.getUserJwtConfig).toBe('function');
  });
});
