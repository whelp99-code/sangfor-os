import { prisma } from "@sangfor/db";
import { hashPasswordCredential } from "../apps/web/src/lib/auth/password-credential";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function readPasswordFromStdin(): Promise<string> {
  if (!process.argv.includes("--password-stdin")) throw new Error("--password-stdin is required; passwords in argv are forbidden");
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8").replace(/[\r\n]+$/u, "");
}

async function main() {
  const email = argument("--email")?.trim().toLowerCase();
  const confirmedUserId = argument("--confirm-user-id")?.trim();
  if (!email || !confirmedUserId) throw new Error("--email and --confirm-user-id are required");
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, status: true, disabledAt: true } });
  if (!user || user.id !== confirmedUserId || user.status !== "active" || user.disabledAt !== null) throw new Error("target must exactly match an active user");
  const passwordDigest = await hashPasswordCredential(await readPasswordFromStdin());
  const now = new Date();
  await prisma.$transaction([
    prisma.userCredential.upsert({
      where: { userId: user.id },
      create: { userId: user.id, passwordDigest },
      update: { passwordDigest, failedAttempts: 0, lockedUntil: null },
    }),
    prisma.authSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  process.stdout.write(`credential provisioned and existing sessions revoked for user ${user.id}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 64;
}).finally(() => prisma.$disconnect());
