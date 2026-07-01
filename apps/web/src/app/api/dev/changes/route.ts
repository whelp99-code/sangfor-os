import { createCodeChangeForRun, listDevActivity } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function GET() {
  try {
    const changes = await listDevActivity();
    return NextResponse.json({ changes });
  } catch (error) {
    return apiError("list_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const { commandRunId, summary, files } = body as {
      commandRunId: string;
      summary: string;
      files: string[];
    };
    const change = await createCodeChangeForRun(commandRunId, summary, files ?? []);
    return NextResponse.json({ change }, { status: 201 });
  } catch (error) {
    return apiError("create_failed", error, { status: 400 });
  }
}
