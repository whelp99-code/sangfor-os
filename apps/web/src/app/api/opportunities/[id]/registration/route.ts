import { getDealRegistration, upsertDealRegistration } from "@sangfor/business/deal-registration";
import { NextResponse } from "next/server";
import { z } from "zod";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";
import { apiError, assertApiAccess } from "@/lib/api-auth";

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

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const registration = await getDealRegistration(id);
    if (!registration) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ registration: serializeDecimalAtBoundary(registration) });
  } catch (error) {
    return apiError("fetch_failed", error, { status: 500 });
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const { id } = await context.params;
  try {
    const body = await request.json();
    const parsed = dealRegistrationInputSchema.parse(body);
    const registration = await upsertDealRegistration(id, parsed);
    return NextResponse.json({ registration: serializeDecimalAtBoundary(registration) });
  } catch (error) {
    return apiError("update_failed", error, { status: 400 });
  }
}
