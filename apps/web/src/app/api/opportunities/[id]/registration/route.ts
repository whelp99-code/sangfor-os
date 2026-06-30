import { getDealRegistration, upsertDealRegistration } from "@sangfor/business/deal-registration";
import { NextResponse } from "next/server";
import { z } from "zod";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

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
  partnerTierMargin: z.number().nullable().optional(),
  conflictNote: z.string().nullable().optional(),
});

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const registration = await getDealRegistration(id);
    if (!registration) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ registration: serializeDecimalAtBoundary(registration) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "fetch_failed" },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  const { id } = await context.params;
  try {
    const body = await request.json();
    const parsed = dealRegistrationInputSchema.parse(body);
    const registration = await upsertDealRegistration(id, parsed);
    return NextResponse.json({ registration: serializeDecimalAtBoundary(registration) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "update_failed" },
      { status: 400 },
    );
  }
}
