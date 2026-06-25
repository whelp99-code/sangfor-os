import { createOpportunity, listOpportunities } from "@ai-portal/automation";
import { NextResponse } from "next/server";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

export async function GET() {
  try {
    const opportunities = await listOpportunities();
    return NextResponse.json({ opportunities: serializeDecimalAtBoundary(opportunities) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "list_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const opportunity = await createOpportunity(body);
    return NextResponse.json({ opportunity: serializeDecimalAtBoundary(opportunity) }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "create_failed" },
      { status: 400 },
    );
  }
}
