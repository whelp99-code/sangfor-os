import { approveRequest } from "@ai-portal/automation";
import { NextResponse } from "next/server";

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { approvalId } = body as { approvalId: string };
    const approval = await approveRequest(approvalId);
    return NextResponse.json({ approval });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "approve_failed" },
      { status: 400 },
    );
  }
}
