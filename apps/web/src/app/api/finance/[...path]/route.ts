import { NextRequest, NextResponse } from "next/server";
import { buildFinanceProxyUrl } from "@/lib/finance-proxy";
import {
  authorizeOperatorRequest,
  findCallerIdentityConflicts,
  stripCallerIdentityFields,
} from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

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
  const authorization = authorizeOperatorRequest(req);
  if (authorization instanceof NextResponse) return authorization;
  const capabilityDenied = await assertBusinessCapability(req, "apps/web/src/app/api/finance/[...path]/route.ts");
  if (capabilityDenied) return capabilityDenied;

  const financeApiKey = process.env.FINANCE_API_KEY?.trim();
  if (!financeApiKey) {
    return NextResponse.json({ error: "AUTH_CONFIGURATION_UNAVAILABLE" }, { status: 503 });
  }

  const url = buildFinanceProxyUrl(req.nextUrl.pathname, req.nextUrl.search);
  const headers: Record<string, string> = {
    "X-API-Key": financeApiKey,
    "X-Actor-Id": authorization.principalId,
    "X-Business-Role": authorization.businessRole,
  };
  const init: RequestInit & { headers: Record<string, string> } = {
    method,
    headers,
  };
  if (method !== "GET" && method !== "HEAD") {
    const body = await req.json().catch(() => undefined);
    if (body) {
      if (findCallerIdentityConflicts(body, authorization.principalId).length > 0) {
        return NextResponse.json({ error: "IDENTITY_CONFLICT" }, { status: 400 });
      }
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(stripCallerIdentityFields(body));
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
