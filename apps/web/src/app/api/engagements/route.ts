import { listEngagements } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";
import { isResourceInProject, resolveProjectScope } from "@/lib/project-scope";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

export async function GET(request: Request) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  try {
    const engagements = (await listEngagements()).filter((engagement) =>
      isResourceInProject(engagement, project.scope),
    );
    return NextResponse.json({ engagements: serializeDecimalAtBoundary(engagements) });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}
