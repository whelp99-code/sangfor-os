import { getOpportunityDetail, resolveOpportunityAuthContext } from "@sangfor/business";
import { getDealRegistration, upsertDealRegistration } from "@sangfor/business/deal-registration";
import { NextResponse } from "next/server";
import { z } from "zod";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { relatedResourcesBelongToProject } from "@/lib/project-scope";

type RouteContext = { params: Promise<{ id: string }> };

const regStatusSchema = z.enum([
  "NOT_SUBMITTED",
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
  "CONTESTED",
]);

const dealRegistrationInputSchema = z.object({
  distributorId: z.string().nullable().optional(),
  registrationNumber: z.string().nullable().optional(),
  regStatus: regStatusSchema.optional(),
  protectionExpiresAt: z.string().nullable().optional(),
  sprStatus: z.string().nullable().optional(),
  partnerTierMargin: z.number().min(0).max(100).nullable().optional(),
  conflictNote: z.string().nullable().optional(),
});

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
      ctx: await resolveOpportunityAuthContext({
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

export async function GET(request: Request, context: RouteContext) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const opportunity = await getOpportunityDetail(auth.ctx, id);
    if (!opportunity) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const registration = await getDealRegistration(id);
    if (!registration) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ registration: serializeDecimalAtBoundary(registration) });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  if (!auth.ctx.permissions.includes("opportunity.write")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await context.params;
  try {
    const opportunity = await getOpportunityDetail(auth.ctx, id);
    if (!opportunity) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const body = await request.json();
    const parsed = dealRegistrationInputSchema.parse(body);
    const distributorAllowed = await relatedResourcesBelongToProject({
      projectId: auth.ctx.projectId,
      projectSlug: "",
    }, [
      { entityType: "partner", entityId: parsed.distributorId },
    ]);
    if (!distributorAllowed) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    const registration = await upsertDealRegistration(id, parsed);
    return NextResponse.json({ registration: serializeDecimalAtBoundary(registration) });
  } catch (error) {
    return apiError("update_failed", error, { status: 400 });
  }
}
