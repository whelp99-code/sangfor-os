import Redis from "ioredis";
import { Client } from "pg";

import { requireInfraEnv } from "@/lib/env";

export type InfraCheckResult = {
  postgres: { ok: boolean; latencyMs?: number; error?: string };
  redis: { ok: boolean; latencyMs?: number; error?: string };
};

/**
 * Purpose:
 * - Probe PostgreSQL and Redis connectivity for Phase 0 infrastructure validation.
 *
 * Failure Points:
 * - Docker services not running or wrong host/port in DATABASE_URL / REDIS_URL.
 * - Connection pool exhaustion under load (Phase 0 uses single-shot clients).
 *
 * Observability:
 * - GET /api/health response body
 * - audit/error_events (Phase 1+)
 *
 * Tests:
 * - src/lib/infra-health.test.ts (CI_INTEGRATION=1)
 */
export async function checkInfraHealth(
  env: Record<string, string | undefined> = process.env,
): Promise<InfraCheckResult> {
  const { databaseUrl, redisUrl } = requireInfraEnv(env);

  const [postgres, redis] = await Promise.all([
    checkPostgres(databaseUrl),
    checkRedis(redisUrl),
  ]);

  return { postgres, redis };
}

async function checkPostgres(databaseUrl: string) {
  const started = Date.now();
  const client = new Client({ connectionString: databaseUrl });

  try {
    await client.connect();
    await client.query("SELECT 1");
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    // Sanitize: raw driver messages leak host:port (e.g. ECONNREFUSED host:port).
    // Log the real cause server-side; return a stable, non-revealing code.
    console.error(
      "[infra-health] postgres_check_failed:",
      error instanceof Error ? error.stack ?? error.message : error,
    );
    return { ok: false, error: "postgres_check_failed" };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function checkRedis(redisUrl: string) {
  const started = Date.now();
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    lazyConnect: true,
  });

  try {
    await client.connect();
    const pong = await client.ping();
    if (pong !== "PONG") {
      return { ok: false, error: "unexpected_pong" };
    }
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    // Sanitize: raw driver messages leak host:port (e.g. ECONNREFUSED host:port).
    // Log the real cause server-side; return a stable, non-revealing code.
    console.error(
      "[infra-health] redis_check_failed:",
      error instanceof Error ? error.stack ?? error.message : error,
    );
    return { ok: false, error: "redis_check_failed" };
  } finally {
    client.disconnect();
  }
}

export function isInfraHealthy(result: InfraCheckResult): boolean {
  return result.postgres.ok && result.redis.ok;
}
