import { healthHistory } from "@/lib/health/history-store";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/history — per-target health time-series + computed
 * stats (uptime %, average latency). Populated by probes to /api/integrations/health.
 */
export async function GET() {
  return Response.json({ targets: healthHistory.snapshot() });
}
