import { convertImprovementToPhase13Run } from "@ai-portal/automation/improvement-loop";
import { NextResponse } from "next/server";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const result = await convertImprovementToPhase13Run(id);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "convert_failed" },
      { status: 400 },
    );
  }
}
