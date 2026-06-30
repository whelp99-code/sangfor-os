import { approveRequest } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function PATCH(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const { approvalId } = body as { approvalId: string };
    const approval = await approveRequest(approvalId);
    return NextResponse.json({ approval });
  } catch (error) {
    return apiError("approve_failed", error, { status: 400 });
  }
}
