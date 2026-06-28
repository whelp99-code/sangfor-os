import { getEngagementDetail } from "@sangfor/business";
import { NextResponse } from "next/server";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const engagement = await getEngagementDetail(id);
    if (!engagement) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ engagement: serializeDecimalAtBoundary(engagement) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "fetch_failed" },
      { status: 500 },
    );
  }
}
