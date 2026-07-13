import { createWorkTask, createWorkTaskSchema, listTodayTasks, listWorkTasks } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import {
  enforceRequestedProject,
  relatedResourcesBelongToProject,
  resolveProjectScope,
} from "@/lib/project-scope";

export async function GET(request: Request) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  const { searchParams } = new URL(request.url);
  const view = searchParams.get("view");
  try {
    const tasks =
      view === "today"
        ? await listTodayTasks(project.scope.projectSlug)
        : await listWorkTasks(project.scope.projectSlug);
    return NextResponse.json({ tasks });
  } catch (error) {
    return apiError("list_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      { status: 400 },
    );
  }

  const result = createWorkTaskSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      {
        error: "validation_error",
        message: "Request body validation failed",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 },
    );
  }

  const forbidden = enforceRequestedProject(project.scope, result.data.projectSlug);
  if (forbidden) return forbidden;

  const relatedAllowed = await relatedResourcesBelongToProject(project.scope, [
    { entityType: "customer", entityId: result.data.customerId },
    { entityType: "partner", entityId: result.data.partnerId },
    { entityType: "engagement", entityId: result.data.engagementId },
  ]);
  if (!relatedAllowed) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const task = await createWorkTask({
      ...result.data,
      projectSlug: project.scope.projectSlug,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}
