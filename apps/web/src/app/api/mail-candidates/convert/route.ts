import { convertApprovedMailCandidates } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const result = await convertApprovedMailCandidates();
    const {
      customersCreated,
      partnersCreated,
      customersSkipped,
      partnersSkipped,
      customersMerged,
      partnersMerged,
      opportunitiesCreated,
      tasksCreated,
    } = result;

    return NextResponse.json({
      success: true,
      customersCreated,
      partnersCreated,
      customersSkipped,
      partnersSkipped,
      customersMerged,
      partnersMerged,
      opportunitiesCreated,
      tasksCreated,
      message: `고객: ${customersCreated}개 생성, ${customersMerged}개 병합, ${customersSkipped}개 제외 | 파트너: ${partnersCreated}개 생성, ${partnersMerged}개 병합, ${partnersSkipped}개 제외 | 기회: ${opportunitiesCreated}개 | 작업: ${tasksCreated}개`,
    });
  } catch (error) {
    return apiError("convert_failed", error, { status: 400 });
  }
}
