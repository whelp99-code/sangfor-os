import {
  createOpportunity,
  createOpportunitySchema,
  listOpportunities,
  resolveOpportunityAuthContext,
} from "@sangfor/business";
import { NextResponse } from "next/server";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { serializeDecimalAtBoundary } from "@/lib/serialize-decimal";

const SCOPE_FIELDS = new Set(["tenantId", "companyId", "projectId", "projectSlug"]);
const QUERY_FIELDS = new Set(["q", "search", "first", "cursor", "ownerAssignmentId", "stage"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function idempotencyKey(request: Request): string | null {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  return key.length > 0 && key.length <= 128 && !CONTROL_CHARACTERS.test(key) ? key : null;
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
  } catch (error) {
    return {
      ok: false as const,
      response: crmError(error, "authorization_failed", 403),
    };
  }
}

function crmError(error: unknown, fallback: string, status: number) {
  if (
    error instanceof Error
    && "httpStatus" in error
    && typeof error.httpStatus === "number"
    && "code" in error
    && typeof error.code === "string"
  ) {
    return NextResponse.json({ error: error.code }, { status: error.httpStatus });
  }
  return apiError(fallback, error, { status });
}

export async function GET(request: Request) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (SCOPE_FIELDS.has(key)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    if (!QUERY_FIELDS.has(key)) {
      return NextResponse.json({ error: "validation_error" }, { status: 422 });
    }
  }
  const firstValue = params.get("first");
  const first = firstValue === null ? undefined : Number(firstValue);
  if (firstValue !== null && (!Number.isInteger(first) || (first ?? 0) < 1 || (first ?? 101) > 100)) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }
  try {
    const page = await listOpportunities(auth.ctx, {
      first,
      cursor: params.get("cursor") ?? undefined,
      ownerAssignmentId: params.get("ownerAssignmentId") ?? undefined,
      stage: (params.get("stage") ?? undefined) as
        | "LEAD"
        | "QUALIFIED"
        | "PROPOSAL"
        | "POC"
        | "NEGOTIATION"
        | "WON"
        | "LOST"
        | undefined,
      search: params.get("q") ?? params.get("search") ?? undefined,
    });
    return NextResponse.json({
      opportunities: serializeDecimalAtBoundary(page.items),
      nextCursor: page.nextCursor,
    });
  } catch (error) {
    return crmError(error, "list_failed", 500);
  }
}

export async function POST(request: Request) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (
    input
    && typeof input === "object"
    && !Array.isArray(input)
    && Object.keys(input).some((key) => SCOPE_FIELDS.has(key))
  ) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const parsed = createOpportunitySchema.safeParse(input);
  const key = idempotencyKey(request);
  if (!parsed.success || !key) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }
  try {
    const opportunity = await createOpportunity(auth.ctx, {
      ...parsed.data,
      idempotencyKey: key,
    });
    return NextResponse.json(
      { opportunity: serializeDecimalAtBoundary(opportunity) },
      { status: 201 },
    );
  } catch (error) {
    return crmError(error, "create_failed", 422);
  }
}
