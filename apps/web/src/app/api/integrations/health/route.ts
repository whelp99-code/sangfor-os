import { NextResponse } from "next/server";
import { probeAllIntegrationTargets } from "@sangfor/infra";

export const dynamic = "force-dynamic";

/**
 * Live health for the containerized MCP integration targets
 * (services/* in docker-compose). Probes each target over HTTP via @sangfor/infra.
 */
export async function GET() {
  try {
    const targets = await probeAllIntegrationTargets();
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
    return NextResponse.json(
      {
        overall: "error",
        targets: [],
        error: error instanceof Error ? error.message : "integration_health_failed",
        timestamp: new Date().toISOString(),
      },
      { status: 500 },
    );
  }
}
