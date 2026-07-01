import { NextResponse } from "next/server";
import { probeAllIntegrationTargets } from "@sangfor/infra";

import { healthHistory } from "@/lib/health/history-store";
import { notifyTransitions } from "@/lib/health/alerts";

export const dynamic = "force-dynamic";

/**
 * Live health for the containerized MCP integration targets
 * (services/* in docker-compose). Probes each target over HTTP via @sangfor/infra.
 */
export async function GET() {
  try {
    const targets = await probeAllIntegrationTargets();

    // Record the probe into the time-series and alert on healthiness flips.
    const transitions = healthHistory.recordAndDetect(
      targets.map((t) => ({ id: t.id, status: t.status, latencyMs: t.latencyMs })),
    );
    if (transitions.length > 0) {
      void notifyTransitions(transitions);
    }

    const healthy = targets.filter((t) => t.status === "healthy").length;
    const degraded = targets.filter((t) => t.status === "degraded").length;
    const unreachable = targets.filter((t) => t.status === "unreachable").length;
    const overall = unreachable > 0 || degraded > 0 ? "degraded" : "ok";

    return NextResponse.json({
      overall,
      summary: {
        total: targets.length,
        healthy,
        degraded,
        unreachable,
        unknown: targets.length - healthy - degraded - unreachable,
      },
      targets,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Sanitize: log the real cause server-side, return a stable code (no raw
    // error.message). Response shape is preserved for the health dashboard.
    console.error("[api] integration_health_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return NextResponse.json(
      {
        overall: "error",
        targets: [],
        error: "integration_health_failed",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
