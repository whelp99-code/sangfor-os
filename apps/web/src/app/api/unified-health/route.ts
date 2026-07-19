/**
 * U006 — unified health endpoint.
 * Response is computed from the canonical @sangfor/health registry + real probes.
 * Never hard-codes fake hosts or static green statuses.
 */
import { probeCanonicalHealth } from "@sangfor/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const report = await probeCanonicalHealth();

  // Strip any accidental non-public fields; services are already redacted.
  const body = {
    overall: report.overall,
    summary: report.summary,
    services: report.services.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      status: s.status,
      criticality: s.criticality,
      ownerWorkspace: s.ownerWorkspace,
      remediation: s.remediation,
      latencyMs: s.latencyMs,
      // detail is redacted in the registry; still omit if empty
      ...(s.detail ? { detail: s.detail } : {}),
    })),
    timestamp: report.timestamp,
  };

  return Response.json(body, { status: report.httpStatus });
}
