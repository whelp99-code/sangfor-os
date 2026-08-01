import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  MFA_KEY_ENV,
  MfaNotConfiguredError,
  isMfaConfigured,
  openTotpSecret,
  sealTotpSecret,
  totpSealingKey,
} from "./totp-seal";

const KEY = randomBytes(32);
const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

describe("sealTotpSecret / openTotpSecret", () => {
  it("round-trips the secret", () => {
    expect(openTotpSecret(sealTotpSecret(SECRET, KEY), KEY)).toBe(SECRET);
  });

  it("produces a different envelope every time for the same secret", () => {
    // A deterministic envelope would let anyone with read access tell which users
    // share a secret, and would break GCM's IV-reuse requirement outright.
    const envelopes = new Set(Array.from({ length: 20 }, () => sealTotpSecret(SECRET, KEY)));
    expect(envelopes.size).toBe(20);
  });

  it("refuses a different key rather than returning garbage", () => {
    expect(openTotpSecret(sealTotpSecret(SECRET, KEY), randomBytes(32))).toBeNull();
  });

  it("refuses a tampered ciphertext, tag, or iv", () => {
    const envelope = sealTotpSecret(SECRET, KEY);
    const [version, iv, tag, ciphertext] = envelope.split(".");
    const flip = (part: string) => {
      const bytes = Buffer.from(part, "base64url");
      bytes[0] ^= 0x01;
      return bytes.toString("base64url");
    };
    expect(openTotpSecret([version, iv, tag, flip(ciphertext)].join("."), KEY)).toBeNull();
    expect(openTotpSecret([version, iv, flip(tag), ciphertext].join("."), KEY)).toBeNull();
    expect(openTotpSecret([version, flip(iv), tag, ciphertext].join("."), KEY)).toBeNull();
  });

  it("refuses a malformed or foreign envelope shape", () => {
    for (const bad of ["", "plaintext-secret", "v1.a.b", "v2.a.b.c", "v1.a.b.c.d"]) {
      expect(openTotpSecret(bad, KEY)).toBeNull();
    }
  });

  it("refuses an envelope whose iv or tag is the wrong length", () => {
    const [, , tag, ciphertext] = sealTotpSecret(SECRET, KEY).split(".");
    expect(openTotpSecret(["v1", randomBytes(8).toString("base64url"), tag, ciphertext].join("."), KEY)).toBeNull();
    expect(openTotpSecret(["v1", randomBytes(12).toString("base64url"), randomBytes(8).toString("base64url"), ciphertext].join("."), KEY)).toBeNull();
  });
});

describe("totpSealingKey", () => {
  it("fails closed when the key is absent, rather than degrading to plaintext", () => {
    expect(() => totpSealingKey({})).toThrow(MfaNotConfiguredError);
    expect(() => totpSealingKey({ [MFA_KEY_ENV]: "   " })).toThrow(MfaNotConfiguredError);
    expect(isMfaConfigured({})).toBe(false);
  });

  it("rejects a key that is not exactly 32 bytes", () => {
    expect(() => totpSealingKey({ [MFA_KEY_ENV]: randomBytes(16).toString("base64") })).toThrow(/32 bytes/u);
    expect(() => totpSealingKey({ [MFA_KEY_ENV]: randomBytes(48).toString("base64") })).toThrow(/32 bytes/u);
  });

  it("accepts a correctly sized base64 key", () => {
    const configured = randomBytes(32);
    const source = { [MFA_KEY_ENV]: configured.toString("base64") };
    expect(totpSealingKey(source)).toEqual(configured);
    expect(isMfaConfigured(source)).toBe(true);
  });
});
