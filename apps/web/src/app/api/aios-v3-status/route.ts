import { NextResponse } from "next/server";

interface ServiceStatus {
  name: string;
  url: string;
  status: "ok" | "error" | "unreachable";
  latencyMs: number;
  detail?: string;
}

async function checkService(
  name: string,
  url: string,
  timeoutMs = 5000,
): Promise<ServiceStatus> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (res.ok) {
      const body = await res.json().catch(() => null);
      return {
        name,
        url,
        status: "ok",
        latencyMs,
        detail: body?.status ?? body?.service ?? undefined,
      };
    }
    return { name, url, status: "error", latencyMs, detail: `${res.status}` };
  } catch (e) {
    return {
      name,
      url,
      status: "unreachable",
      latencyMs: Date.now() - start,
      detail: e instanceof Error ? e.message : "unknown",
    };
  }
}

export async function GET() {
  const [v3Server, lmStudio] = await Promise.all([
    checkService("F-aios-v3 Server", "http://localhost:3201/api/health"),
    checkService("LM Studio", "http://localhost:1234/v1/models"),
  ]);

  const allOk = [v3Server, lmStudio].every((s) => s.status === "ok");

  return NextResponse.json({
    overall: allOk ? "ok" : "degraded",
    services: [v3Server, lmStudio],
    timestamp: new Date().toISOString(),
  });
}
