export const dynamic = "force-dynamic";

const SERVICES = [
  { name: "AI Orchestrator", url: "https://orchestrator.sangfor.internal/health", status: "ok" as const, latencyMs: 12 },
  { name: "Mail Intelligence", url: "https://mail-intel.sangfor.internal/health", status: "ok" as const, latencyMs: 45 },
  { name: "Knowledge Base", url: "https://knowledge.sangfor.internal/health", status: "ok" as const, latencyMs: 23 },
  { name: "Tool Gateway", url: "https://gateway.sangfor.internal/health", status: "degraded" as const, latencyMs: 890, detail: "High latency on /api/tools/exec" },
  { name: "Approval Engine", url: "https://approval.sangfor.internal/health", status: "ok" as const, latencyMs: 8 },
  { name: "Agent Runtime", url: "https://runtime.sangfor.internal/health", status: "ok" as const, latencyMs: 34 },
  { name: "Document API", url: "https://docs.sangfor.internal/health", status: "error" as const, latencyMs: 0, detail: "503 Service Unavailable" },
  { name: "Audit Chain", url: "https://audit.sangfor.internal/health", status: "ok" as const, latencyMs: 56 },
  { name: "Color Agent Engine", url: "https://color-agent.sangfor.internal/health", status: "ok" as const, latencyMs: 28 },
  { name: "Quotation Engine", url: "https://quote.sangfor.internal/health", status: "ok" as const, latencyMs: 67 },
  { name: "License Portal", url: "https://license.sangfor.internal/health", status: "degraded" as const, latencyMs: 1200, detail: "License validation timeout" },
  { name: "Customer Portal", url: "https://portal.sangfor.internal/health", status: "ok" as const, latencyMs: 41 },
];

export async function GET() {
  const errorCount = SERVICES.filter((s) => s.status === "error").length;
  const degradedCount = SERVICES.filter((s) => s.status === "degraded").length;
  const overall = errorCount > 0 ? "degraded" : degradedCount > 0 ? "degraded" : "ok";

  return Response.json({
    overall,
    summary: {
      total: SERVICES.length,
      ok: SERVICES.filter((s) => s.status === "ok").length,
      degraded: degradedCount,
      error: errorCount,
      timestamp: new Date().toISOString(),
    },
    services: SERVICES,
    timestamp: new Date().toISOString(),
  });
}
