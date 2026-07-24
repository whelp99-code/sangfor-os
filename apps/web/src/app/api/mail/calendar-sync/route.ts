import { resolveOpportunityAuthContext } from "@sangfor/business";
import { z } from "zod";
import { NextResponse } from "next/server";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { syncCalendarMeetings } from "@/lib/outlook";

const bodySchema = z.object({
  opportunityId: z.string().trim().min(1).max(200).optional(),
  daysBack: z.number().int().min(0).max(365).optional(),
  daysAhead: z.number().int().min(0).max(365).optional(),
}).strict();
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCOPE_FIELDS = new Set([
  "projectSlug",
  "tenantId",
  "companyId",
  "projectId",
  "actor",
  "assignmentId",
  "role",
]);

function requestKey(request: Request): string | null {
  const value = request.headers.get("idempotency-key")?.trim() ?? "";
  return value.length > 0 && value.length <= 128 && !CONTROL_CHARACTERS.test(value)
    ? value
    : null;
}

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

export async function POST(request: Request) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    input = {};
  }
  if (
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).some((field) => SCOPE_FIELDS.has(field))
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(input);
  const idempotencyKey = requestKey(request);
  if (!parsed.success || !idempotencyKey) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }

  try {
    const result = await syncCalendarMeetings(auth.ctx, {
      ...parsed.data,
      idempotencyKey,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (
      error instanceof Error &&
      "httpStatus" in error &&
      typeof error.httpStatus === "number" &&
      "code" in error &&
      typeof error.code === "string"
    ) {
      return NextResponse.json({ error: error.code }, { status: error.httpStatus });
    }
    return apiError("calendar_sync_failed", error, {
      status: 502,
      extra: { success: false },
    });
  }
}
