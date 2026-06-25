import { listSkillCatalog } from "@sangfor/business/skills";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const phase = searchParams.get("phase");
    const skills = listSkillCatalog(
      phase ? { phase: Number.parseInt(phase, 10) } : undefined,
    );
    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "list_failed" },
      { status: 500 },
    );
  }
}
