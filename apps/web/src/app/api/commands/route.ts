import { createCommandRun, listCommandRuns } from "@sangfor/business";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const runs = await listCommandRuns();
    return NextResponse.json({ runs });
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
    const run = await createCommandRun(body);
    return NextResponse.json({ run }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "create_failed" },
      { status: 400 },
    );
  }
}
