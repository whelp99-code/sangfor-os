import type { PrismaClient } from "@prisma/client";

const U044_WRITE_TABLES = [
  "product_families",
  "product_editions",
  "product_skus",
  "license_metrics",
] as const;

const U044_READ_ONLY_TABLES = [
  "companies",
] as const;

export async function applyU044RlsGrants(admin: PrismaClient) {
  const allTables = [...U044_WRITE_TABLES, ...U044_READ_ONLY_TABLES];

  for (const table of allTables) {
    const [{ regclass }] = await admin.$queryRawUnsafe<{ regclass: string | null }[]>(
      `SELECT to_regclass('public."${table}"')::text as regclass;`
    );
    if (!regclass) {
      throw new Error(
        `Migration drift detected: table "public.${table}" does not exist in the scratch database.`
      );
    }
  }

  for (const table of U044_WRITE_TABLES) {
    await admin.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "${table}" TO sangfor_app;`
    );
  }

  for (const table of U044_READ_ONLY_TABLES) {
    await admin.$executeRawUnsafe(
      `GRANT SELECT ON TABLE "${table}" TO sangfor_app;`
    );
  }
}
