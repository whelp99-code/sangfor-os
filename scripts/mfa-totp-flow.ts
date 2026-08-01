/**
 * Drives the real TOTP flow — enroll, confirm, step up, replay — against a real
 * PostgreSQL with the real migrations applied, through the same service layer the
 * HTTP routes call. Unit tests prove the algorithm; this proves the storage, the
 * CHECK constraints, and the replay ledger behave as designed together.
 *
 * Prints MFA_TOTP_FLOW=PASS on success; any assertion failure throws.
 */
import { randomBytes, randomUUID } from "node:crypto";

import { prisma } from "@sangfor/db";
import { decodeBase32, totpCode, totpCounter } from "@sangfor/auth";

import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  removeTotpFactor,
  totpFactorStatus,
  verifyTotpForSession,
} from "../apps/web/src/lib/auth/mfa";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`MFA_TOTP_FLOW assertion failed: ${message}`);
}

async function main(): Promise<void> {
  const suffix = randomUUID().slice(0, 8);
  const tenantId = `mfa-tenant-${suffix}`;
  const companyId = `mfa-company-${suffix}`;
  const projectId = `mfa-project-${suffix}`;
  const userId = `mfa-user-${suffix}`;
  const sessionId = `mfa-jti-${suffix}`;
  const otherSessionId = `mfa-jti-other-${suffix}`;

  await prisma.tenant.create({ data: { id: tenantId, name: "MFA Proof Tenant", slug: `mfa-${suffix}` } });
  await prisma.company.create({ data: { id: companyId, tenantId, name: "MFA Proof Co", slug: `mfa-c-${suffix}` } });
  await prisma.project.create({ data: { id: projectId, companyId, name: "MFA Proof Project", slug: `mfa-p-${suffix}` } });
  await prisma.user.create({ data: { id: userId, email: `${userId}@example.test`, name: "MFA Proof", status: "active" } });
  await prisma.userCredential.create({ data: { userId, passwordDigest: "$scrypt$v1$unused$unused" } });

  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + 900_000);
  for (const id of [sessionId, otherSessionId]) {
    await prisma.authSession.create({ data: { id, userId, tenantId, companyId, projectId, issuedAt, expiresAt } });
  }

  // 1. No factor yet — a step-up must be refused outright.
  assert((await totpFactorStatus(userId)).enrolled === false, "reported enrolled before enrollment");
  const beforeEnroll = await verifyTotpForSession(userId, sessionId, "000000");
  assert(!beforeEnroll.ok && beforeEnroll.reason === "NO_FACTOR", `expected NO_FACTOR, got ${JSON.stringify(beforeEnroll)}`);

  // 2. Enroll. The secret is returned once and stored sealed.
  const enrollment = await beginTotpEnrollment(userId, `${userId}@example.test`);
  assert("secretBase32" in enrollment, "enrollment refused unexpectedly");
  const secret = enrollment.secretBase32;
  const stored = await prisma.userCredential.findUniqueOrThrow({ where: { userId }, select: { totpSecret: true } });
  assert(stored.totpSecret !== null && !stored.totpSecret.includes(secret), "the secret was stored in a recoverable form");
  assert(stored.totpSecret.startsWith("v1."), "stored value is not a sealed envelope");
  assert((await totpFactorStatus(userId)).pending === true, "pending factor not reported");

  // 3. A pending factor cannot be used for step-up until confirmed.
  const beforeConfirm = await verifyTotpForSession(userId, sessionId, totpCode(decodeBase32(secret), totpCounter(new Date())));
  assert(!beforeConfirm.ok && beforeConfirm.reason === "NO_FACTOR", `unconfirmed factor accepted: ${JSON.stringify(beforeConfirm)}`);

  // 4. A wrong code does not confirm.
  const wrongConfirm = await confirmTotpEnrollment(userId, "000000");
  const confirmedAfterWrong = await prisma.userCredential.findUniqueOrThrow({ where: { userId }, select: { totpConfirmedAt: true } });
  assert(!wrongConfirm.ok, "a wrong code confirmed the factor");
  assert(confirmedAfterWrong.totpConfirmedAt === null, "a failed confirm still activated the factor");

  // 5. The right code confirms it.
  const now = new Date();
  const code = totpCode(decodeBase32(secret), totpCounter(now));
  const confirmed = await confirmTotpEnrollment(userId, code, now);
  assert(confirmed.ok, `confirm failed: ${JSON.stringify(confirmed)}`);
  assert((await totpFactorStatus(userId)).enrolled === true, "factor not reported enrolled after confirm");

  // 6. The confirmation code is spent — it cannot immediately be reused to step up.
  const replayOfConfirm = await verifyTotpForSession(userId, sessionId, code, now);
  assert(!replayOfConfirm.ok && replayOfConfirm.reason === "REPLAYED_CODE", `confirm code was replayable: ${JSON.stringify(replayOfConfirm)}`);

  // 7. The next step's code stamps the presented session and only that session.
  const nextWindow = new Date(now.getTime() + 30_000);
  const nextCode = totpCode(decodeBase32(secret), totpCounter(nextWindow));
  const stepUp = await verifyTotpForSession(userId, sessionId, nextCode, nextWindow);
  assert(stepUp.ok, `step-up failed: ${JSON.stringify(stepUp)}`);
  const stamped = await prisma.authSession.findUniqueOrThrow({ where: { id: sessionId } });
  const untouched = await prisma.authSession.findUniqueOrThrow({ where: { id: otherSessionId } });
  assert(stamped.mfaVerifiedAt !== null, "the verified session was not stamped");
  assert(stamped.mfaMethod === "totp", `unexpected mfaMethod ${stamped.mfaMethod}`);
  assert(untouched.mfaVerifiedAt === null, "MFA evidence leaked to another session");

  // 8. That code is now spent too.
  const replay = await verifyTotpForSession(userId, sessionId, nextCode, nextWindow);
  assert(!replay.ok && replay.reason === "REPLAYED_CODE", `code was replayable: ${JSON.stringify(replay)}`);

  // 9. Another user's secret never verifies against this factor.
  const foreignCode = totpCode(randomBytes(20), totpCounter(nextWindow));
  const foreign = await verifyTotpForSession(userId, sessionId, foreignCode, nextWindow);
  assert(!foreign.ok, "a foreign secret's code was accepted");

  // 10. Re-enrollment over a live factor is refused.
  const reEnroll = await beginTotpEnrollment(userId, `${userId}@example.test`);
  assert("ok" in reEnroll && reEnroll.ok === false && reEnroll.reason === "ALREADY_ENROLLED", "a live factor was silently replaced");

  // 11. Removal clears every trace, and the CHECK constraints stay satisfied.
  await removeTotpFactor(userId);
  const cleared = await prisma.userCredential.findUniqueOrThrow({ where: { userId } });
  assert(cleared.totpSecret === null && cleared.totpConfirmedAt === null && cleared.totpLastCounter === null, "removal left residue");

  process.stdout.write("MFA_TOTP_FLOW=PASS\n");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    await prisma.$disconnect();
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  });
