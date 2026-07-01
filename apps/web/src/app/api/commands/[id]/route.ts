import { buildTimeline, getCommandRunDetail } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const run = await getCommandRunDetail(id);
    if (!run) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ run, timeline: buildTimeline(run) });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}
