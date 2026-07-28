import { z } from "zod";
import {
  assertProcessProfile,
  resolveProcessProfile,
  type ProcessProfileName,
} from "@sangfor/config";

/**
 * Purpose:
 * - Validate runtime environment variables before infra health checks run.
 * - U006: wire process profile resolution for local|test|production.
 *
 * Failure Points:
 * - Missing DATABASE_URL or REDIS_URL when health/integration tests expect them.
 * - Malformed connection strings fail Zod URL parsing.
 * - Production profile missing critical secrets (fail-closed via assertProcessProfile).
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
  SANGFOR_PROCESS_PROFILE: z.enum(["local", "test", "production"]).optional(),
});

export type PortalEnv = z.infer<typeof envSchema>;

export function parsePortalEnv(
  source: Record<string, string | undefined> = process.env,
): PortalEnv {
  return envSchema.parse({
    DATABASE_URL: source.DATABASE_URL,
    REDIS_URL: source.REDIS_URL,
    NEXT_PUBLIC_APP_URL: source.NEXT_PUBLIC_APP_URL,
    SANGFOR_PROCESS_PROFILE: source.SANGFOR_PROCESS_PROFILE,
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

/** Resolve the active process profile (U006). */
export function getPortalProcessProfile(
  source: NodeJS.ProcessEnv = process.env,
): ProcessProfileName {
  return resolveProcessProfile(source);
}

/**
 * Fail-closed production profile check for the web process.
 * Safe to call at startup; no-ops for local/test.
 */
export function assertWebProcessProfile(
  source: NodeJS.ProcessEnv = process.env,
): void {
  assertProcessProfile("web", source);
}
