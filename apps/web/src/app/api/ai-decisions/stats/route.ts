import { getDecisionStats } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

/**
 * Read-model: AI/워커 의사결정 집계(캘리브레이션 토대) 노출.
 *
 * 관례: summary/route.ts · domain-pipeline/route.ts 판박이 — business
 * read-model을 그대로 호출하고, 실패는 apiError로 정화한다. read 전용이라
 * assertApiAccess는 불필요.
 *
 * 선택 스코프 쿼리파라미터:
 *   ?projectId=<id>  특정 프로젝트로 한정
 *   ?domain=<gtm>    특정 도메인(sales 등)으로 한정
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    const domain = url.searchParams.get("domain");

    const where: Record<string, unknown> = {};
    if (projectId) where.projectId = projectId;
    if (domain) where.domain = domain;

    const stats = await getDecisionStats(
      Object.keys(where).length > 0 ? { where } : {},
    );
    return NextResponse.json(stats);
  } catch (error) {
    return apiError("ai_decision_stats_failed", error, { status: 400 });
  }
}
