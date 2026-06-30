import { recommendSkillsForInput } from "@sangfor/business/skills";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const result = await recommendSkillsForInput(body);
    return NextResponse.json(result);
  } catch (error) {
    return apiError("recommend_failed", error, { status: 400 });
  }
}
