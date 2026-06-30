import { analyzeIntent } from "@sangfor/business/automation-preview";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    return NextResponse.json({ analysis: analyzeIntent(body), previewOnly: true });
  } catch (error) {
    return apiError("automation_analyze_failed", error, { status: 400 });
  }
}
