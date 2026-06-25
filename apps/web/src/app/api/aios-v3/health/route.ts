import { NextResponse } from "next/server";

import {
  getAiosV3Config,
  getMonitoringHealth,
  listLmStudioModels,
} from "@/lib/aios-v3-bridge";

/**
 * Purpose:
 * - Expose a unified health check that reports the readiness of:
 *   1. The F-aios-v3-core server (localhost:3501)
 *   2. LM Studio (localhost:1234)
 *   3. The AIOS v1 ↔ v3 bridge configuration
 *
 * Failure Points:
 * - v3 server unreachable → degraded status with connection hint.
 * - LM Studio unreachable → degraded status (non-critical for some flows).
 * - Misconfigured URLs → configuration error in response.
 *
 * Observability:
 * - GET /api/aios-v3/health → { status, services: { v3Server, lmStudio }, config, timestamp }
 */

interface ServiceHealth {
  status: "healthy" | "unreachable" | "error";
  latencyMs?: number;
  detail?: string;
}

export async function GET() {
  const timestamp = new Date().toISOString();
  const config = getAiosV3Config();

  const services: Record<string, ServiceHealth> = {};

  // --- v3 Server health ---
  try {
    const start = Date.now();
    const monitoringHealth = await getMonitoringHealth();
    services.v3Server = {
      status: monitoringHealth.status === "error" ? "error" : "healthy",
      latencyMs: Date.now() - start,
      detail: monitoringHealth.status,
    };
  } catch (error) {
    services.v3Server = {
      status: "unreachable",
      detail: error instanceof Error ? error.message : "unknown_error",
    };
  }

  // --- LM Studio health ---
  try {
    const start = Date.now();
    const models = await listLmStudioModels();
    services.lmStudio = {
      status: "healthy",
      latencyMs: Date.now() - start,
      detail: `${models.data?.length ?? 0} model(s) available`,
    };
  } catch (error) {
    services.lmStudio = {
      status: "unreachable",
      detail: error instanceof Error ? error.message : "unknown_error",
    };
  }

  const allHealthy = Object.values(services).every((s) => s.status === "healthy");
  const anyUnreachable = Object.values(services).some((s) => s.status === "unreachable");

  let status: "ok" | "degraded" | "error";
  if (allHealthy) {
    status = "ok";
  } else if (anyUnreachable) {
    status = "degraded";
  } else {
    status = "error";
  }

  return NextResponse.json(
    {
      status,
      services,
      config: {
        serverBaseUrl: config.serverBaseUrl,
        lmStudioBaseUrl: config.lmStudioBaseUrl,
        debug: config.debug,
      },
      timestamp,
    },
    { status: allHealthy ? 200 : 503 },
  );
}
