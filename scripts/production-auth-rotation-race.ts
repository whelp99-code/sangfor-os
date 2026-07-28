import { prisma } from "@sangfor/db";
import { CredentialVersionMismatchError, createPersistedSession } from "../apps/web/src/lib/auth/persisted-session";

const userId = "production-race-user";
const tenantId = "production-race-tenant";
const companyId = "production-race-company";
const projectId = "production-race-project";

await prisma.tenant.create({ data: { id: tenantId, name: "Race Tenant", slug: tenantId } });
await prisma.company.create({ data: { id: companyId, tenantId, name: "Race Company", slug: companyId } });
await prisma.project.create({ data: { id: projectId, companyId, name: "Race Project", slug: projectId } });
await prisma.user.create({ data: { id: userId, email: "race@example.test", name: "Race User", status: "active" } });
await prisma.userCredential.create({ data: { userId, passwordDigest: `$scrypt$v1$${"a".repeat(22)}$${"b".repeat(86)}`, credentialVersion: 1 } });

const create = createPersistedSession({ userId, tenantId, companyId, projectId, projectSlug: projectId, role: "admin", credentialVersion: 1 });
const rotate = prisma.$transaction(async (tx) => {
  await tx.userCredential.update({ where: { userId }, data: { credentialVersion: { increment: 1 }, passwordDigest: `$scrypt$v1$${"c".repeat(22)}$${"d".repeat(86)}` } });
  await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
});
const [createResult, rotateResult] = await Promise.allSettled([create, rotate]);
if (rotateResult.status !== "fulfilled") throw rotateResult.reason;
if (createResult.status === "rejected" && !(createResult.reason instanceof CredentialVersionMismatchError)) throw createResult.reason;
const liveSessions = await prisma.authSession.count({ where: { userId, revokedAt: null } });
const credential = await prisma.userCredential.findUniqueOrThrow({ where: { userId }, select: { credentialVersion: true } });
if (credential.credentialVersion !== 2 || liveSessions !== 0) throw new Error(`rotation race invariant failed: version=${credential.credentialVersion} live=${liveSessions}`);
process.stdout.write(`PRODUCTION_AUTH_ROTATION_RACE=PASS outcome=${createResult.status}\n`);
await prisma.$disconnect();
