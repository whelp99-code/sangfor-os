import { batchProcessMailCandidates } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const { action, minConfidence = 85 } = body;

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "invalid_action" }, { status: 400 });
    }

    const result = await batchProcessMailCandidates({ action, minConfidence });

    return NextResponse.json({
      success: true,
      action: result.action,
      count: result.count,
      message:
        result.action === "approve"
          ? `${result.count}개 후보 승인 완료`
          : `${result.count}개 후보 거부 완료`,
    });
  } catch (error) {
    return apiError("batch_failed", error, { status: 400 });
  }
}
