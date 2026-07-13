import { getEngagementDetail } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";
import { isResourceInProject, resolveProjectScope } from "@/lib/project-scope";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  const { id } = await context.params;
  try {
    const engagement = await getEngagementDetail(id);
    if (!isResourceInProject(engagement, project.scope)) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ engagement: serializeDecimalAtBoundary(engagement) });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}
