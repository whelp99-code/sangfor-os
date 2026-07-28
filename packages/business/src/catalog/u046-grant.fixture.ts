import type { PrismaClient } from "@prisma/client";

export async function applyU046RlsGrants(admin: PrismaClient) {
  await admin.$executeRawUnsafe(
    `GRANT ALL ON ALL TABLES IN SCHEMA public TO sangfor_app;`
  );
  await admin.$executeRawUnsafe(
    `GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO sangfor_app;`
  );
}
