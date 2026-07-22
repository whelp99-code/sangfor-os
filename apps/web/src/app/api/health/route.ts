import { NextResponse } from "next/server";
import { probeCanonicalHealth } from "@sangfor/health";

/**
 * Purpose:
 * Canonical liveness/readiness endpoint. Service IDs, timeouts, process
 * profiles, and status semantics are owned by U006's @sangfor/health package.
 */
export async function GET() {
  try {
    const report = await probeCanonicalHealth();

    return NextResponse.json(
      {
        overall: report.overall,
        summary: report.summary,
        services: report.services,
        timestamp: report.timestamp,
      },
      { status: report.httpStatus },
    );
  } catch (error) {
    console.error(
      "[api] health_check_failed:",
      error instanceof Error ? error.stack ?? error.message : error,
    );

    return NextResponse.json(
      {
        overall: "error",
        summary: {
          total: 0,
          ok: 0,
          degraded: 0,
          error: 1,
          disabled: 0,
          timestamp: new Date().toISOString(),
        },
        services: [],
        error: "health_check_failed",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
