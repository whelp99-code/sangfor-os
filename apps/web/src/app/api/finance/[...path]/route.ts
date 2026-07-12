import { NextRequest, NextResponse } from "next/server";
import { buildFinanceProxyUrl } from "@/lib/finance-proxy";
import { assertApiAccess } from "@/lib/api-auth";
import { requireRole } from "@/lib/auth/rbac";

type ParsedFinanceResponse =
  | { ok: true; data: unknown }
  | { ok: false };

function parseFinanceResponse(text: string): ParsedFinanceResponse {
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch {
    // Never echo raw upstream text back to the client — it may carry internal
    // detail (stack hints, driver text, payloads). Log server-side and return
    // a stable, generic envelope.
    console.error("[api] finance_upstream_parse_failed:", text);
    return { ok: false };
  }
}

async function proxy(req: NextRequest, method: string) {
  // The proxy injects a real upstream API key (FINANCE_API_KEY||API_KEY), so
  // every method must be authenticated — otherwise an unauthenticated client
  // could perform CFO financial CRUD (role gate bypass). In dev/demo this
  // passes when AUTH_BYPASS_ENABLED=1; in prod it hard-blocks with 401.
  const denied = assertApiAccess(req);
  if (denied) return denied;
  const forbidden = requireRole(req, ["admin", "operator", "finance"]);
  if (forbidden) return forbidden;

  const url = buildFinanceProxyUrl(req.nextUrl.pathname, req.nextUrl.search);
  const headers: Record<string, string> = {
    "X-API-Key": process.env.FINANCE_API_KEY || process.env.API_KEY || "",
  };
  const init: RequestInit & { headers: Record<string, string> } = {
    method,
    headers,
  };
  if (method !== "GET" && method !== "HEAD") {
    const body = await req.json().catch(() => undefined);
    if (body) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
  }
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    if (!text) {
      return NextResponse.json(null, { status: res.status });
    }
    const parsed = parseFinanceResponse(text);
    if (!parsed.ok) {
      return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
    }
    return NextResponse.json(parsed.data, { status: res.status });
  } catch (error) {
    console.error("[api] finance_proxy_unavailable:", error instanceof Error ? error.stack ?? error.message : error);
    // Upstream unreachable or connection failure — 502 (bad gateway) is the
    // semantically correct status; this is an upstream problem, not ours.
    return NextResponse.json({ error: "upstream_unavailable" }, { status: 502 });
  }
}

export function GET(req: NextRequest) {
  return proxy(req, "GET");
}
export function POST(req: NextRequest) {
  return proxy(req, "POST");
}
export function PUT(req: NextRequest) {
  return proxy(req, "PUT");
}
export function PATCH(req: NextRequest) {
  return proxy(req, "PATCH");
}
export function DELETE(req: NextRequest) {
  return proxy(req, "DELETE");
}
