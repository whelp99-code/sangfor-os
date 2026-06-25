import { NextRequest, NextResponse } from "next/server";

const FINANCE_API_URL = process.env.FINANCE_API_URL || "http://localhost:4100";

async function proxy(req: NextRequest, method: string) {
  const path = req.nextUrl.pathname.replace("/api/finance/", "");
  const url = `${FINANCE_API_URL}/api/${path}${req.nextUrl.search}`;
  const headers: Record<string, string> = {
    "X-API-Key": process.env.FINANCE_API_KEY || "",
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
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Finance service unavailable" },
      { status: 503 },
    );
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
