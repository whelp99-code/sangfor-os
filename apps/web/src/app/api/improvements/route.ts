import {
  createImprovementCandidateFromError,
  listImprovementCandidates,
} from "@sangfor/business/improvement-loop";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const severity = searchParams.get("severity") ?? undefined;
  const candidates = await listImprovementCandidates({
    status: status as "proposed" | "approved" | "rejected" | "converted" | undefined,
    severity: severity as "low" | "medium" | "high" | "critical" | undefined,
    limit: 50,
  });
  return NextResponse.json({ candidates });
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/improvements/route.ts");
  if (capabilityDenied) return capabilityDenied;
  try {
    const body = await request.json();
    const candidate = await createImprovementCandidateFromError(body);
    return NextResponse.json({ candidate }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}
