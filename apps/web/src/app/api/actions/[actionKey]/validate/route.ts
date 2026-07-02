import { validateActionWithDb } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ actionKey: string }> };

export async function POST(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const { actionKey } = await context.params;
    const validation = await validateActionWithDb(actionKey);
    if (validation.errors.includes("action_not_found")) {
      return NextResponse.json(validation, { status: 404 });
    }
    const status = validation.valid ? 200 : 400;
    return NextResponse.json(validation, { status });
  } catch (error) {
    return apiError("validate_action_failed", error, { status: 500 });
  }
}
