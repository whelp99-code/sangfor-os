import { NextRequest } from "next/server";

import { assertApiAccess } from "@/lib/api-auth";
import { proxyFinanceRequest } from "@/lib/finance-proxy-handler";

function proxy(req: NextRequest, method: string) {
  const denied = assertApiAccess(req);
  if (denied) return denied;
  return proxyFinanceRequest(req, method, true);
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
