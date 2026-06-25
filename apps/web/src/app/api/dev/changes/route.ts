import { createCodeChangeForRun, listDevActivity } from "@ai-portal/automation";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const changes = await listDevActivity();
    return NextResponse.json({ changes });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "list_failed" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "create_failed" },
      { status: 400 },
    );
  }
}
