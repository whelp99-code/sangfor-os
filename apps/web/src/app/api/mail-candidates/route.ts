import {
  generateMailDerivedCandidates,
  generateMailDerivedCandidatesHybrid,
  listScopedMailDerivedCandidates,
} from "@sangfor/business/mail-candidates";
import { resolveCrmAuthContext } from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

async function resolveContext(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return { ok: false as const, response: denied };
  const session = await evaluatePersistedSessionFromRequest(request);
  if (!session.ok) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  try {
    return {
      ok: true as const,
      ctx: await resolveCrmAuthContext({
        userId: session.userId,
        sessionId: null,
        tenantId: session.tenantId,
        companyId: session.companyId,
        projectId: session.projectId,
        product: "portal",
      }),
    };
  } catch {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
}

export async function GET(request: Request) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") ?? undefined;
  const candidateType = searchParams.get("type") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? "100");

  const candidates = await listScopedMailDerivedCandidates(auth.ctx, {
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
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/mail-candidates/route.ts");
  if (capabilityDenied) return capabilityDenied;
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
