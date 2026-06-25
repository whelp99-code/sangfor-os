import {
  createImprovementCandidateFromError,
  listImprovementCandidates,
} from "@ai-portal/automation/improvement-loop";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const severity = searchParams.get("severity") ?? undefined;
  const candidates = await listImprovementCandidates({
    status: status as "proposed" | "approved" | "rejected" | "converted" | undefined,
    severity: severity as "low" | "medium" | "high" | "critical" | undefined,
    limit: 50,
  });
  return NextResponse.json({ candidates });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const candidate = await createImprovementCandidateFromError(body);
    return NextResponse.json({ candidate }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "create_failed" },
      { status: 400 },
    );
  }
}
