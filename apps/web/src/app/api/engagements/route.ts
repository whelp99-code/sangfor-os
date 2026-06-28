import { listEngagements } from "@sangfor/business";
import { NextResponse } from "next/server";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

export async function GET() {
  try {
    const engagements = await listEngagements();
    return NextResponse.json({ engagements: serializeDecimalAtBoundary(engagements) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "fetch_failed" },
      { status: 500 },
    );
  }
}
