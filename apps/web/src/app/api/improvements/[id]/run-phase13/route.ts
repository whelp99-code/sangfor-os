import { convertImprovementToPhase13Run } from "@sangfor/business/improvement-loop";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const result = await convertImprovementToPhase13Run(id);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError("convert_failed", error, { status: 400 });
  }
}
