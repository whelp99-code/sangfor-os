import { recommendSkillsForInput } from "@sangfor/business/skills";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await recommendSkillsForInput(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "recommend_failed" },
      { status: 400 },
    );
  }
}
