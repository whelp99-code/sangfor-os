import { createCommandRun, listCommandRuns } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function GET() {
  try {
    const runs = await listCommandRuns();
    return NextResponse.json({ runs });
  } catch (error) {
    return apiError("list_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const run = await createCommandRun(body);
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}
