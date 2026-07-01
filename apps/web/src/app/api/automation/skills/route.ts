import { listSkillCatalog } from "@sangfor/business/skills";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const phase = searchParams.get("phase");
    const skills = listSkillCatalog(
      phase ? { phase: Number.parseInt(phase, 10) } : undefined,
    );
    return NextResponse.json({ skills });
  } catch (error) {
    return apiError("list_failed", error, { status: 500 });
  }
}
