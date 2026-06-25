import { runSingleSkill } from "@sangfor/business/skills";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = await runSingleSkill(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "run_failed" },
      { status: 400 },
    );
  }
}
