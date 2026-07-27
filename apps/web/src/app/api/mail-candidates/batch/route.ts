import { NextResponse } from "next/server";
import { assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/mail-candidates/batch/route.ts");
  if (capabilityDenied) return capabilityDenied;
  return NextResponse.json(
    {
      error: "batch_mail_candidate_commands_retired",
      message: "후보별 버전과 멱등 키가 필요한 개별 승인 흐름을 사용하세요.",
    },
    { status: 410 },
  );
}
