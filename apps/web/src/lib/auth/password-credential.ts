import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { Prisma, prisma } from "@sangfor/db";

const scrypt = promisify(nodeScrypt);
const DIGEST_PREFIX = "$scrypt$v1$";
const DUMMY_DIGEST = "$scrypt$v1$paWlpaWlpaWlpaWlpaWlpQ$eG48qZyW3FwWDVqH10MhhEZYBg0yRdLyCrx1K3IXTTTxgZQgt9z0rBHJznmi7GmL15yhyqVj3ZD__lXGC838RA";
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

export async function hashPasswordCredential(password: string): Promise<string> {
  if (password.length < 16 || password.length > 1024) throw new TypeError("password must contain 16-1024 characters");
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `${DIGEST_PREFIX}${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPasswordDigest(password: string, digest: string): Promise<boolean> {
  const parts = digest.split("$");
  if (parts.length !== 5 || `$${parts[1]}$${parts[2]}$` !== DIGEST_PREFIX) return false;
  try {
    const salt = Buffer.from(parts[3], "base64url");
    const expected = Buffer.from(parts[4], "base64url");
    if (salt.length !== 16 || expected.length !== 64) return false;
    const actual = await scrypt(password, salt, expected.length) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

interface AuthenticatedPasswordCredential {
  readonly userId: string;
  readonly credentialVersion: number;
}

export async function authenticatePasswordCredential(email: string, password: string, now = new Date()): Promise<AuthenticatedPasswordCredential | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || password.length < 1 || password.length > 1024) return null;
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, status: true, disabledAt: true, credential: true },
  });
  const credential = user?.credential;
  const verified = await verifyPasswordDigest(password, credential?.passwordDigest ?? DUMMY_DIGEST);
  if (!user || user.status !== "active" || user.disabledAt !== null || !credential) return null;
  if (credential.lockedUntil && credential.lockedUntil.getTime() > now.getTime()) return null;
  if (!verified) {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE user_credentials
      SET failed_attempts = LEAST(${MAX_FAILED_ATTEMPTS}, failed_attempts + 1),
          locked_until = CASE
            WHEN failed_attempts >= ${MAX_FAILED_ATTEMPTS - 1} THEN ${new Date(now.getTime() + LOCK_DURATION_MS)}
            ELSE locked_until
          END,
          updated_at = ${now}
      WHERE user_id = ${user.id}
    `);
    return null;
  }
  await prisma.userCredential.update({
    where: { userId: user.id },
    data: { failedAttempts: 0, lockedUntil: null, lastAuthenticatedAt: now },
  });
  return { userId: user.id, credentialVersion: credential.credentialVersion };
}
