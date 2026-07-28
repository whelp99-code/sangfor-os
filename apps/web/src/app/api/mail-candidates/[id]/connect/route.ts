import { resolveCrmAuthContext } from "@sangfor/business";
import { approveAndConnectMailCandidate } from "@sangfor/business/mail-candidate-connections";
import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

type Params = { params: Promise<{ id: string }> };
const bodySchema = z.object({
  expectedUpdatedAt: z.string().datetime({ offset: true }),
}).strict();
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const SCOPE_FIELDS = new Set([
  "tenantId",
  "companyId",
  "projectId",
  "projectSlug",
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

export async function POST(request: Request, { params }: Params) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const idempotencyKey = requestKey(request);
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
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
  if (!parsed.success || !idempotencyKey) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }
  const { id } = await params;
  try {
    const result = await approveAndConnectMailCandidate(auth.ctx, {
      candidateId: id,
      expectedUpdatedAt: parsed.data.expectedUpdatedAt,
      idempotencyKey,
    });
    const opportunity = result.items.find((item) => item.entityType === "opportunity");
    return NextResponse.json({
      ...result,
      redirectTo: opportunity ? `/deals/${opportunity.entityId}` : "/approvals",
    });
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
    return apiError("connect_failed", error, { status: 400 });
  }
}
