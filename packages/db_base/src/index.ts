import { PrismaClient } from "@prisma/client";

/**
 * Purpose:
 * - Shared Prisma client for DB Kernel access across apps.
 *
 * Failure Points:
 * - DATABASE_URL missing or pointing at wrong port (5434 local vs 5432 CI).
 * - migrate deploy not run before app start.
 *
 * Observability:
 * - audit.state_transition_logs, audit.error_events (Phase 1+ writes)
 *
 * Tests:
 * - prisma/seed-chain.test.ts
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
