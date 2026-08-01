import { prisma } from "@sangfor/db";
import { generateTotpSecret, totpEnrollmentUri, verifyTotpCode, type TotpFailure } from "@sangfor/auth";

import { openTotpSecret, sealTotpSecret, totpSealingKey } from "./totp-seal";

export const TOTP_ISSUER = "Sangfor OS";
export const TOTP_METHOD = "totp";

export type MfaOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: TotpFailure | "NO_FACTOR" | "ALREADY_ENROLLED" | "FACTOR_UNREADABLE" };

export interface TotpEnrollment {
  readonly secretBase32: string;
  readonly uri: string;
}

/**
 * Issues a fresh secret and stores it unconfirmed. Refuses while a confirmed
 * factor exists: overwriting one from a merely-authenticated session would let
 * anyone holding a stolen cookie swap the second factor for their own, which is
 * the one thing the factor is supposed to prevent. Replacing a live factor goes
 * through `removeTotpFactor`, which requires proving the current one.
 */
export async function beginTotpEnrollment(userId: string, account: string): Promise<TotpEnrollment | { readonly ok: false; readonly reason: "ALREADY_ENROLLED" }> {
  const key = totpSealingKey();
  const existing = await prisma.userCredential.findUnique({
    where: { userId },
    select: { totpConfirmedAt: true },
  });
  if (existing?.totpConfirmedAt) return { ok: false, reason: "ALREADY_ENROLLED" };

  const secretBase32 = generateTotpSecret();
  await prisma.userCredential.update({
    where: { userId },
    data: { totpSecret: sealTotpSecret(secretBase32, key), totpConfirmedAt: null, totpLastCounter: null },
  });
  return { secretBase32, uri: totpEnrollmentUri({ secretBase32, account, issuer: TOTP_ISSUER }) };
}

/**
 * Activates a pending factor once the enrollee proves a code from it, and records
 * that counter so the same code cannot immediately be replayed as a step-up.
 */
export async function confirmTotpEnrollment(userId: string, code: string, now: Date = new Date()): Promise<MfaOutcome> {
  const key = totpSealingKey();
  const credential = await prisma.userCredential.findUnique({
    where: { userId },
    select: { totpSecret: true, totpConfirmedAt: true },
  });
  if (!credential?.totpSecret) return { ok: false, reason: "NO_FACTOR" };
  if (credential.totpConfirmedAt) return { ok: false, reason: "ALREADY_ENROLLED" };

  const secret = openTotpSecret(credential.totpSecret, key);
  if (!secret) return { ok: false, reason: "FACTOR_UNREADABLE" };

  const verification = verifyTotpCode(secret, code, { now, lastCounter: null });
  if (!verification.ok) return { ok: false, reason: verification.reason };

  await prisma.userCredential.update({
    where: { userId },
    data: { totpConfirmedAt: now, totpLastCounter: verification.counter },
  });
  return { ok: true };
}

/**
 * Verifies a code against the confirmed factor and, on success, stamps the
 * presented session as MFA-verified.
 *
 * The counter advance and the session stamp share a transaction: a code that was
 * spent must never leave the ledger un-advanced, or it stays replayable.
 */
export async function verifyTotpForSession(
  userId: string,
  sessionId: string,
  code: string,
  now: Date = new Date(),
): Promise<MfaOutcome> {
  const key = totpSealingKey();
  const credential = await prisma.userCredential.findUnique({
    where: { userId },
    select: { totpSecret: true, totpConfirmedAt: true, totpLastCounter: true },
  });
  if (!credential?.totpSecret || !credential.totpConfirmedAt) return { ok: false, reason: "NO_FACTOR" };

  const secret = openTotpSecret(credential.totpSecret, key);
  if (!secret) return { ok: false, reason: "FACTOR_UNREADABLE" };

  const verification = verifyTotpCode(secret, code, { now, lastCounter: credential.totpLastCounter });
  if (!verification.ok) return { ok: false, reason: verification.reason };

  await prisma.$transaction(async (tx) => {
    // Compare-and-set on the ledger: two requests racing the same code both pass
    // verification above, and only the one that advances the counter may stamp.
    const advanced = await tx.userCredential.updateMany({
      where: {
        userId,
        OR: [{ totpLastCounter: null }, { totpLastCounter: { lt: verification.counter } }],
      },
      data: { totpLastCounter: verification.counter },
    });
    if (advanced.count !== 1) throw new TotpRaceLostError();
    await tx.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { mfaVerifiedAt: now, mfaMethod: TOTP_METHOD },
    });
  });
  return { ok: true };
}

class TotpRaceLostError extends Error {
  constructor() {
    super("totp: code consumed concurrently");
    this.name = "TotpRaceLostError";
  }
}

export function isTotpRaceLost(error: unknown): boolean {
  return error instanceof TotpRaceLostError;
}

/** Removes the factor. Callers must already have proved a fresh code. */
export async function removeTotpFactor(userId: string): Promise<void> {
  await prisma.userCredential.update({
    where: { userId },
    data: { totpSecret: null, totpConfirmedAt: null, totpLastCounter: null },
  });
}

export async function totpFactorStatus(userId: string): Promise<{ enrolled: boolean; pending: boolean }> {
  const credential = await prisma.userCredential.findUnique({
    where: { userId },
    select: { totpSecret: true, totpConfirmedAt: true },
  });
  return { enrolled: Boolean(credential?.totpConfirmedAt), pending: Boolean(credential?.totpSecret && !credential.totpConfirmedAt) };
}
