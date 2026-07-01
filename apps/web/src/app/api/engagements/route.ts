import { listEngagements } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

export async function GET() {
  try {
    const engagements = await listEngagements();
    return NextResponse.json({ engagements: serializeDecimalAtBoundary(engagements) });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}
