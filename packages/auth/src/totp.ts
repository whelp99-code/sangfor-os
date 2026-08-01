import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 TOTP, hand-rolled on node:crypto for the same reason the password
 * digest and the internal-context HMAC are: the algorithm is small, the repo
 * already owns equivalent primitives, and a dependency here would be a supply
 * chain edge on the second authentication factor.
 *
 * Everything in this module is pure. Secret storage, session state, and clock
 * ownership belong to the caller.
 */

/** RFC 4226 recommends 160 bits of shared secret. */
export const TOTP_SECRET_BYTES = 20;
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/**
 * Accept the immediately adjacent steps. One step either side tolerates real
 * clock drift and slow typing; widening it multiplies the codes valid at any
 * instant, which is exactly the brute-force surface.
 */
export const TOTP_SKEW_STEPS = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Unpadded RFC 4648 base32. Throws on any character outside the alphabet so a
 *  mistyped secret fails loudly instead of silently decoding to other bytes. */
export function decodeBase32(text: string): Buffer {
  const normalized = text.replace(/[\s-]/gu, '').replace(/=+$/u, '').toUpperCase();
  if (normalized.length === 0) throw new Error('totp: empty base32 secret');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error('totp: invalid base32 character');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret(): string {
  return encodeBase32(randomBytes(TOTP_SECRET_BYTES));
}

/** The RFC 6238 time step counter. Floor division, so it is stable within a step. */
export function totpCounter(now: Date, stepSeconds: number = TOTP_STEP_SECONDS): number {
  return Math.floor(now.getTime() / 1000 / stepSeconds);
}

/** RFC 4226 HOTP with dynamic truncation, rendered zero-padded to `digits`. */
export function totpCode(secret: Buffer, counter: number, digits: number = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export type TotpFailure = 'MALFORMED_CODE' | 'INVALID_CODE' | 'REPLAYED_CODE';

export type TotpVerification =
  | { readonly ok: true; readonly counter: number }
  | { readonly ok: false; readonly reason: TotpFailure };

export interface VerifyTotpOptions {
  readonly now: Date;
  /**
   * The highest counter this secret has already been used at. A TOTP code stays
   * valid for a whole step, so without this a code observed once — over the
   * user's shoulder, in a log, in a proxy — is replayable until it expires.
   */
  readonly lastCounter: number | null;
  readonly stepSeconds?: number;
  readonly digits?: number;
  readonly skewSteps?: number;
}

/**
 * Verifies a submitted code and returns the counter it matched, so the caller can
 * persist it and refuse that counter and everything below it next time.
 */
export function verifyTotpCode(
  secretBase32: string,
  submittedCode: string,
  options: VerifyTotpOptions,
): TotpVerification {
  const digits = options.digits ?? TOTP_DIGITS;
  const stepSeconds = options.stepSeconds ?? TOTP_STEP_SECONDS;
  const skewSteps = options.skewSteps ?? TOTP_SKEW_STEPS;
  const candidate = submittedCode.replace(/[\s-]/gu, '');
  if (!new RegExp(`^[0-9]{${digits}}$`, 'u').test(candidate)) return { ok: false, reason: 'MALFORMED_CODE' };

  const secret = decodeBase32(secretBase32);
  const current = totpCounter(options.now, stepSeconds);
  const submitted = Buffer.from(candidate, 'utf8');

  // Scan the whole window even after a hit: bailing early would leak, through
  // timing, which step matched.
  let matched: number | null = null;
  for (let counter = current - skewSteps; counter <= current + skewSteps; counter += 1) {
    if (counter < 0) continue;
    const expected = Buffer.from(totpCode(secret, counter, digits), 'utf8');
    if (expected.length === submitted.length && timingSafeEqual(expected, submitted) && matched === null) {
      matched = counter;
    }
  }
  if (matched === null) return { ok: false, reason: 'INVALID_CODE' };
  if (options.lastCounter !== null && matched <= options.lastCounter) return { ok: false, reason: 'REPLAYED_CODE' };
  return { ok: true, counter: matched };
}

export interface TotpEnrollmentUriInput {
  readonly secretBase32: string;
  /** Shown in the authenticator app — an email or username. */
  readonly account: string;
  readonly issuer: string;
  readonly digits?: number;
  readonly stepSeconds?: number;
}

/** `otpauth://` URI for authenticator apps, per the Key Uri Format. */
export function totpEnrollmentUri(input: TotpEnrollmentUriInput): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const parameters = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: 'SHA1',
    digits: String(input.digits ?? TOTP_DIGITS),
    period: String(input.stepSeconds ?? TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
}
