import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";

export type AppRole = "admin" | "operator" | "finance" | "viewer";

// Skeleton role gate. The current single-operator deployment always passes
// (operator is in every P0 allow-list), so behaviour is unchanged; a future
// viewer/finance role is enforced here without editing the call sites.
export function requireRole(request: Request, allowed: AppRole[]): NextResponse | null {
  const { role } = getSessionFromRequest(request);
  if ((allowed as string[]).includes(role)) return null;
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}
