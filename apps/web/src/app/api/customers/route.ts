import { createCustomer, createCustomerSchema, listCustomers } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { enforceRequestedProject, resolveProjectScope } from "@/lib/project-scope";

export async function GET(request: Request) {
  const project = await resolveProjectScope(request);
  if (!project.ok) return project.response;
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("q") ?? undefined;
  try {
    const customers = await listCustomers(project.scope.projectSlug, search);
    return NextResponse.json({ customers });
  } catch (error) {
    return apiError("list_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/customers/route.ts");
  if (capabilityDenied) return capabilityDenied;
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

  const result = createCustomerSchema.safeParse(body);
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

  try {
    const customer = await createCustomer({
      ...result.data,
      projectSlug: project.scope.projectSlug,
    });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}
