import {
  generateMailDerivedCandidates,
  generateMailDerivedCandidatesHybrid,
  listMailDerivedCandidates,
} from "@sangfor/business/mail-candidates";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const candidateType = searchParams.get("type") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? "100");

  const candidates = await listMailDerivedCandidates({
    status: status as
      | "needs_revalidation"
      | "proposed"
      | "approved"
      | "rejected"
      | "converted"
      | "knowledge_only"
      | undefined,
    candidateType: candidateType as
      | "customer"
      | "partner"
      | "task"
      | "opportunity"
      | "poc"
      | undefined,
    limit: Number.isFinite(limit) ? limit : 100,
  });

  return NextResponse.json({ candidates });
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  try {
    const body = await request.json().catch(() => ({}));

    // hybrid=true 파라미터가 있으면 AI 하이브리드 분류 사용
    const useHybrid = body.hybrid === true || body.hybrid === "true";

    const legacyKnowledgeFallback =
      body.legacyKnowledgeFallback === true || body.legacyKnowledgeFallback === "true";
    const input = {
      limit: Number(body.limit ?? 50),
      legacyKnowledgeFallback,
    };

    const result = useHybrid
      ? await generateMailDerivedCandidatesHybrid(input)
      : await generateMailDerivedCandidates(input);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return apiError("generate_failed", error, { status: 400 });
  }
}
