import { NextResponse } from "next/server";
import {
  probeCanonicalHealth,
  type UnifiedHealthStatus,
} from "@sangfor/health";

import { healthHistory } from "@/lib/health/history-store";
import { notifyTransitions } from "@/lib/health/alerts";

export const dynamic = "force-dynamic";

/**
 * Live health for the containerized MCP integration targets. U006 owns the
 * registry and probe semantics; the legacy `targets` field is presentation-only
 * compatibility for the existing integration panel.
 */
function toPresentationStatus(status: UnifiedHealthStatus): string {
  switch (status) {
    case "ok":
      return "healthy";
    case "error":
      return "unreachable";
    default:
      return status;
  }
}

export async function GET() {
  try {
    const report = await probeCanonicalHealth();
    const targets = report.services.map((service) => ({
      id: service.id,
      status: toPresentationStatus(service.status),
      upstream: service.url,
      ...(service.detail ? { details: service.detail } : {}),
      readinessNote: service.remediation,
      latencyMs: service.latencyMs,
    }));

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
    const unknown = targets.filter((t) => t.status === "unknown").length;
    const disabled = targets.filter((t) => t.status === "disabled").length;

    return NextResponse.json(
      {
        overall: report.overall,
        summary: {
          total: targets.length,
          healthy,
          degraded,
          unreachable,
          unknown,
          disabled,
        },
        services: report.services,
        targets,
        timestamp: report.timestamp,
      },
      { status: report.httpStatus },
    );
  } catch (error) {
    // Sanitize: log the real cause server-side, return a stable code (no raw
    // error.message). Response shape is preserved for the health dashboard.
    console.error("[api] integration_health_failed:", error instanceof Error ? error.stack ?? error.message : error);
    return NextResponse.json(
      {
        overall: "error",
        summary: {
          total: 0,
          healthy: 0,
          degraded: 0,
          unreachable: 0,
          unknown: 1,
          disabled: 0,
        },
        services: [],
        targets: [],
        error: "integration_health_failed",
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
