import { createOpportunity, listOpportunities } from "@sangfor/business";
import { NextResponse } from "next/server";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function GET() {
  try {
    const opportunities = await listOpportunities();
    return NextResponse.json({ opportunities: serializeDecimalAtBoundary(opportunities) });
  } catch (error) {
    return apiError("list_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const opportunity = await createOpportunity(body);
    return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}
