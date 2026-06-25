import { NextResponse } from "next/server";

import {
  checkInfraHealth,
  isInfraHealthy,
} from "@/lib/infra-health";

/**
 * Purpose:
 * - Expose Phase 0 infrastructure readiness (PostgreSQL + Redis) for local dev and CI smoke checks.
 *
 * Failure Points:
 * - Missing DATABASE_URL / REDIS_URL → 503 with configuration hint.
 * - Docker services stopped → dependency-specific error fields in JSON body.
 *
 * Observability:
 * - GET /api/health JSON: { status, checks, timestamp }
 * - scripts/run-all-checks.sh optional curl
 *
 * Tests:
 * - src/lib/infra-health.test.ts
 */
export async function GET() {
  const timestamp = new Date().toISOString();

  try {
    const checks = await checkInfraHealth(process.env);
    const healthy = isInfraHealthy(checks);

    return NextResponse.json(
      {
        status: healthy ? "ok" : "degraded",
        checks,
        timestamp,
      },
      { status: healthy ? 200 : 503 },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "health_check_failed";

    return NextResponse.json(
      {
        status: "error",
        error: message,
        timestamp,
      },
      { status: 503 },
    );
  }
}
