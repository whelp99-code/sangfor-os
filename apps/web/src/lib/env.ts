import { z } from "zod";

/**
 * Purpose:
 * - Validate runtime environment variables before infra health checks run.
 *
 * Failure Points:
 * - Missing DATABASE_URL or REDIS_URL when health/integration tests expect them.
 * - Malformed connection strings fail Zod URL parsing.
 *
 * Observability:
 * - Vitest: src/lib/env.test.ts
 * - API route errors surface Zod issue paths in development only.
 *
 * Tests:
 * - src/lib/env.test.ts
 */
const connectionUrl = (prefix: string) =>
  z
    .string()
    .min(1)
    .refine((value) => value.startsWith(prefix), {
      message: `Must start with ${prefix}`,
    });

const envSchema = z.object({
  DATABASE_URL: connectionUrl("postgresql://").optional(),
  REDIS_URL: connectionUrl("redis://").optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
});

export type PortalEnv = z.infer<typeof envSchema>;

export function parsePortalEnv(
  source: Record<string, string | undefined> = process.env,
): PortalEnv {
  return envSchema.parse({
    DATABASE_URL: source.DATABASE_URL,
    REDIS_URL: source.REDIS_URL,
    NEXT_PUBLIC_APP_URL: source.NEXT_PUBLIC_APP_URL,
  });
}

export function requireInfraEnv(
  source: Record<string, string | undefined> = process.env,
): { databaseUrl: string; redisUrl: string } {
  const parsed = envSchema
    .extend({
      DATABASE_URL: connectionUrl("postgresql://"),
      REDIS_URL: connectionUrl("redis://"),
    })
    .parse({
      DATABASE_URL: source.DATABASE_URL,
      REDIS_URL: source.REDIS_URL,
    });

  return {
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
  };
}
