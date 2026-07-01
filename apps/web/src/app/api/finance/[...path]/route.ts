import { NextRequest, NextResponse } from "next/server";
import { buildFinanceProxyUrl } from "@/lib/finance-proxy";
import { assertApiAccess } from "@/lib/api-auth";

async function proxy(req: NextRequest, method: string) {
  // The proxy injects a real upstream API key (FINANCE_API_KEY||API_KEY), so
  // every method must be authenticated — otherwise an unauthenticated client
  // could perform CFO financial CRUD (role gate bypass). In dev/demo this
  // passes when AUTH_BYPASS_ENABLED=1; in prod it hard-blocks with 401.
  const denied = assertApiAccess(req);
  if (denied) return denied;

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
    const data = text ? parseFinanceResponse(text) : null;
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Finance service unavailable" },
      { status: 503 },
    );
  }
}

function parseFinanceResponse(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    // Never echo raw upstream text back to the client — it may carry internal
    // detail (stack hints, driver text, payloads). Log server-side and return
    // a stable, generic envelope.
    console.error("[api] finance_upstream_parse_failed:", text);
    return { error: "invalid_upstream_response" };
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
