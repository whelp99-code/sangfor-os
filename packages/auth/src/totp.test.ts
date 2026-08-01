import { describe, expect, it } from 'vitest';

import {
  TOTP_SKEW_STEPS,
  TOTP_STEP_SECONDS,
  decodeBase32,
  encodeBase32,
  generateTotpSecret,
  totpCode,
  totpCounter,
  totpEnrollmentUri,
  verifyTotpCode,
} from './totp';

/** RFC 6238 Appendix B, SHA-1 rows. The seed is the ASCII string "12345678901234567890". */
const RFC_SECRET = encodeBase32(Buffer.from('12345678901234567890', 'utf8'));
const RFC_VECTORS: ReadonlyArray<readonly [seconds: number, code: string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('totpCode', () => {
  it('reproduces every RFC 6238 SHA-1 test vector', () => {
    for (const [seconds, expected] of RFC_VECTORS) {
      const counter = totpCounter(new Date(seconds * 1000));
      expect(totpCode(decodeBase32(RFC_SECRET), counter, 8)).toBe(expected);
    }
  });

  it('truncates to the requested digit count', () => {
    const counter = totpCounter(new Date(59_000));
    expect(totpCode(decodeBase32(RFC_SECRET), counter, 8)).toBe('94287082');
    // Six digits is the low-order slice of the same dynamic truncation.
    expect(totpCode(decodeBase32(RFC_SECRET), counter, 6)).toBe('287082');
  });

  it('pads a short code to the full width', () => {
    // A truncated value below 10^(digits-1) must still present as `digits` characters,
    // or the authenticator and the verifier disagree on the string.
    const secret = decodeBase32(encodeBase32(Buffer.alloc(20, 7)));
    const codes = Array.from({ length: 400 }, (_, counter) => totpCode(secret, counter));
    expect(codes.every((code) => code.length === 6)).toBe(true);
    expect(codes.some((code) => code.startsWith('0'))).toBe(true);
  });
});

describe('base32', () => {
  it('round-trips arbitrary byte lengths', () => {
    for (let length = 1; length <= 24; length += 1) {
      const bytes = Buffer.from(Array.from({ length }, (_, index) => (index * 37 + 11) & 0xff));
      expect(decodeBase32(encodeBase32(bytes))).toEqual(bytes);
    }
  });

  it('accepts the spacing and casing authenticator apps display', () => {
    expect(decodeBase32('JBSW Y3DP')).toEqual(decodeBase32('jbswy3dp'));
    expect(decodeBase32('JBSW-Y3DP')).toEqual(decodeBase32('JBSWY3DP'));
  });

  it('rejects characters outside the alphabet instead of decoding them to something else', () => {
    // 0/1/8/9 are excluded from RFC 4648 base32 precisely because they are
    // confusable; silently mapping them would accept a mistyped secret.
    expect(() => decodeBase32('JBSW0IDP')).toThrow(/invalid base32/u);
    expect(() => decodeBase32('')).toThrow(/empty base32/u);
  });
});

describe('generateTotpSecret', () => {
  it('produces a distinct 160-bit secret each time', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(50);
    for (const secret of secrets) expect(decodeBase32(secret)).toHaveLength(20);
  });
});

describe('verifyTotpCode', () => {
  const secret = encodeBase32(Buffer.alloc(20, 3));
  const now = new Date(1_700_000_000_000);
  const currentCounter = totpCounter(now);

  it('accepts the current code and reports the counter it matched', () => {
    const result = verifyTotpCode(secret, totpCode(decodeBase32(secret), currentCounter), {
      now,
      lastCounter: null,
    });
    expect(result).toEqual({ ok: true, counter: currentCounter });
  });

  it('accepts one step of drift either side and nothing beyond it', () => {
    for (const offset of [-TOTP_SKEW_STEPS, 0, TOTP_SKEW_STEPS]) {
      const code = totpCode(decodeBase32(secret), currentCounter + offset);
      expect(verifyTotpCode(secret, code, { now, lastCounter: null })).toEqual({
        ok: true,
        counter: currentCounter + offset,
      });
    }
    for (const offset of [-2, 2]) {
      const code = totpCode(decodeBase32(secret), currentCounter + offset);
      expect(verifyTotpCode(secret, code, { now, lastCounter: null })).toEqual({
        ok: false,
        reason: 'INVALID_CODE',
      });
    }
  });

  it('refuses a code already used, and every counter below it', () => {
    // The whole point of the counter ledger: a code seen once must not work again
    // for the rest of its 30-second life.
    const code = totpCode(decodeBase32(secret), currentCounter);
    expect(verifyTotpCode(secret, code, { now, lastCounter: currentCounter })).toEqual({
      ok: false,
      reason: 'REPLAYED_CODE',
    });
    const previous = totpCode(decodeBase32(secret), currentCounter - 1);
    expect(verifyTotpCode(secret, previous, { now, lastCounter: currentCounter })).toEqual({
      ok: false,
      reason: 'REPLAYED_CODE',
    });
  });

  it('lets the next step through once the ledger has advanced', () => {
    const later = new Date(now.getTime() + TOTP_STEP_SECONDS * 1000);
    const code = totpCode(decodeBase32(secret), currentCounter + 1);
    expect(verifyTotpCode(secret, code, { now: later, lastCounter: currentCounter })).toEqual({
      ok: true,
      counter: currentCounter + 1,
    });
  });

  it('separates a malformed submission from a wrong one', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 5']) {
      expect(verifyTotpCode(secret, bad, { now, lastCounter: null })).toEqual({
        ok: false,
        reason: 'MALFORMED_CODE',
      });
    }
    const wrong = totpCode(decodeBase32(secret), currentCounter) === '000000' ? '111111' : '000000';
    expect(verifyTotpCode(secret, wrong, { now, lastCounter: null }).ok).toBe(false);
  });

  it('tolerates the spacing authenticator apps insert', () => {
    const code = totpCode(decodeBase32(secret), currentCounter);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotpCode(secret, spaced, { now, lastCounter: null })).toEqual({
      ok: true,
      counter: currentCounter,
    });
  });

  it('does not accept another secret\u2019s code', () => {
    const other = encodeBase32(Buffer.alloc(20, 9));
    const code = totpCode(decodeBase32(other), currentCounter);
    expect(verifyTotpCode(secret, code, { now, lastCounter: null })).toEqual({
      ok: false,
      reason: 'INVALID_CODE',
    });
  });
});

describe('totpEnrollmentUri', () => {
  it('emits a Key Uri an authenticator can import', () => {
    const uri = totpEnrollmentUri({
      secretBase32: 'JBSWY3DP',
      account: 'jm.park@blro.co.kr',
      issuer: 'Sangfor OS',
    });
    const parsed = new URL(uri);
    expect(parsed.protocol).toBe('otpauth:');
    expect(parsed.host).toBe('totp');
    expect(decodeURIComponent(parsed.pathname)).toBe('/Sangfor OS:jm.park@blro.co.kr');
    expect(parsed.searchParams.get('secret')).toBe('JBSWY3DP');
    expect(parsed.searchParams.get('issuer')).toBe('Sangfor OS');
    expect(parsed.searchParams.get('digits')).toBe('6');
    expect(parsed.searchParams.get('period')).toBe('30');
    expect(parsed.searchParams.get('algorithm')).toBe('SHA1');
  });
});
