import {
  archiveCustomer,
  archiveCustomerSchema,
  getCustomerDetail,
  resolveCrmAuthContext,
  updateCustomer,
  updateCustomerSchema,
} from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

type RouteContext = { params: Promise<{ id: string }> };
const SCOPE_FIELDS = new Set(["tenantId", "companyId", "projectId", "projectSlug"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const patchBodySchema = updateCustomerSchema.omit({ idempotencyKey: true });
const archiveBodySchema = archiveCustomerSchema.omit({ idempotencyKey: true });

function forbiddenScope(input: unknown): boolean {
  return !!input && typeof input === "object" && !Array.isArray(input)
    && Object.keys(input).some((key) => SCOPE_FIELDS.has(key));
}

function idempotencyKey(request: Request): string | null {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  return key.length >= 1 && key.length <= 128 && !CONTROL_CHARACTERS.test(key) ? key : null;
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
    const ctx = await resolveCrmAuthContext({
      userId: session.userId,
      sessionId: null,
      tenantId: session.tenantId,
      companyId: session.companyId,
      projectId: session.projectId,
      product: "portal",
    });
    return { ok: true as const, ctx };
  } catch (error) {
    return {
      ok: false as const,
      response: crmErrorResponse(error, "authorization_failed", 403),
    };
  }
}

function crmErrorResponse(error: unknown, fallback: string, fallbackStatus: number) {
  if (
    error instanceof Error
    && "httpStatus" in error
    && typeof error.httpStatus === "number"
    && "code" in error
    && typeof error.code === "string"
  ) {
    return NextResponse.json({ error: error.code }, { status: error.httpStatus });
  }
  return apiError(fallback, error, { status: fallbackStatus });
}

async function readJson(request: Request): Promise<
  { ok: true; value: unknown } | { ok: false; response: NextResponse }
> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "invalid_json" }, { status: 400 }),
    };
  }
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  try {
    const customer = await getCustomerDetail(auth.ctx, id);
    if (!customer) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ customer });
  } catch (error) {
    return crmErrorResponse(error, "fetch_failed", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const parsedJson = await readJson(request);
  if (!parsedJson.ok) return parsedJson.response;
  if (forbiddenScope(parsedJson.value)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = patchBodySchema.safeParse(parsedJson.value);
  const key = idempotencyKey(request);
  if (!body.success || !key) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }
  try {
    const customer = await updateCustomer(auth.ctx, id, {
      ...body.data,
      idempotencyKey: key,
    });
    return NextResponse.json({ customer });
  } catch (error) {
    return crmErrorResponse(error, "update_failed", 422);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const parsedJson = await readJson(request);
  if (!parsedJson.ok) return parsedJson.response;
  if (forbiddenScope(parsedJson.value)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = archiveBodySchema.safeParse(parsedJson.value);
  const key = idempotencyKey(request);
  if (!body.success || !key) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }
  try {
    const customer = await archiveCustomer(auth.ctx, id, {
      ...body.data,
      idempotencyKey: key,
    });
    return NextResponse.json({ customer });
  } catch (error) {
    return crmErrorResponse(error, "archive_failed", 422);
  }
}
