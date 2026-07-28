import { cleanupMailCandidates } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/mail-candidates/cleanup/route.ts");
  if (capabilityDenied) return capabilityDenied;
  try {
    const { duplicatesRemoved, nexiasFixed } = await cleanupMailCandidates();

    return NextResponse.json({
      success: true,
      duplicatesRemoved,
      nexiasFixed,
      message: `중복 제거: ${duplicatesRemoved}개, Nexias 수정: ${nexiasFixed}개`,
    });
  } catch (error) {
    return apiError("cleanup_failed", error, { status: 400 });
  }
}
