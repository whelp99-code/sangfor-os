import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Sealing for the TOTP shared secret.
 *
 * The password digest survives a database read because it is one-way. A TOTP
 * secret cannot be — verification needs the original bytes — so stored in the
 * clear it would turn any dump into a permanent second-factor bypass. That is not
 * hypothetical here: this host writes a nightly logical backup to disk, and the
 * key below never appears in it.
 *
 * The key is deliberately NOT derived from the session-JWT keyring. That keyring
 * rotates and retires kids on a schedule; an enrolled factor must outlive it.
 */
const KEY_BYTES = 32;
const IV_BYTES = 12;
const ENVELOPE_VERSION = "v1";

export const MFA_KEY_ENV = "MFA_TOTP_KEY";
export const MFA_NOT_CONFIGURED = "MFA_NOT_CONFIGURED" as const;

export class MfaNotConfiguredError extends Error {
  constructor() {
    super(`${MFA_KEY_ENV} is not set; TOTP enrollment and verification are unavailable`);
    this.name = "MfaNotConfiguredError";
  }
}

/** Only the lookup this module performs. Narrower than `NodeJS.ProcessEnv`, which
 *  this project augments with required keys a caller has no reason to supply. */
type EnvSource = Readonly<Record<string, string | undefined>>;

/** Reads the sealing key. Throws rather than falling back, so a missing key can
 *  never silently downgrade storage to plaintext. */
export function totpSealingKey(source: EnvSource = process.env): Buffer {
  const configured = source[MFA_KEY_ENV]?.trim();
  if (!configured) throw new MfaNotConfiguredError();
  const key = Buffer.from(configured, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`${MFA_KEY_ENV} must decode to exactly ${KEY_BYTES} bytes (base64 of 32 random bytes)`);
  }
  return key;
}

export function isMfaConfigured(source: EnvSource = process.env): boolean {
  try {
    totpSealingKey(source);
    return true;
  } catch {
    return false;
  }
}

/** `v1.<iv>.<tag>.<ciphertext>`, all base64url. */
export function sealTotpSecret(secretBase32: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  return [
    ENVELOPE_VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

/** Returns null for anything that does not authenticate, so a tampered or
 *  foreign-key envelope is indistinguishable from an absent factor. */
export function openTotpSecret(envelope: string, key: Buffer): string | null {
  const parts = envelope.split(".");
  if (parts.length !== 4) return null;
  const [version, ivPart, tagPart, ciphertextPart] = parts;
  if (!timingSafeEqual(Buffer.from(version.padEnd(8, "\0")), Buffer.from(ENVELOPE_VERSION.padEnd(8, "\0")))) {
    return null;
  }
  try {
    const iv = Buffer.from(ivPart, "base64url");
    const tag = Buffer.from(tagPart, "base64url");
    if (iv.length !== IV_BYTES || tag.length !== 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
