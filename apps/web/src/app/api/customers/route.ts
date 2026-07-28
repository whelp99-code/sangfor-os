import {
  createCustomer,
  createCustomerSchema,
  listCustomers,
  resolveCrmAuthContext,
} from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

const SCOPE_FIELDS = new Set(["tenantId", "companyId", "projectId", "projectSlug"]);
const ALLOWED_QUERY_FIELDS = new Set(["q", "search", "domain", "first", "cursor"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

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

export async function GET(request: Request) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const { searchParams } = new URL(request.url);
  for (const key of searchParams.keys()) {
    if (SCOPE_FIELDS.has(key)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    if (!ALLOWED_QUERY_FIELDS.has(key)) {
      return NextResponse.json({ error: "validation_error" }, { status: 422 });
    }
  }
  const search = searchParams.get("q") ?? searchParams.get("search") ?? undefined;
  const firstValue = searchParams.get("first");
  const first = firstValue === null ? undefined : Number(firstValue);
  if (
    firstValue !== null &&
    (!Number.isInteger(first) || (first ?? 0) < 1 || (first ?? 101) > 100)
  ) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }
  try {
    const page = await listCustomers(auth.ctx, {
      search,
      domain: searchParams.get("domain") ?? undefined,
      first,
      cursor: searchParams.get("cursor") ?? undefined,
    });
    return NextResponse.json({ customers: page.items, nextCursor: page.nextCursor });
  } catch (error) {
    return crmErrorResponse(error, "list_failed", 500);
  }
}

export async function POST(request: Request) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      { status: 400 },
    );
  }
  if (forbiddenScope(body)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const result = createCustomerSchema.safeParse(body);
  if (!result.success) {
    return NextResponse.json(
      {
        error: "validation_error",
        message: "Request body validation failed",
        details: result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }
  const key = idempotencyKey(request);
  if (!key) {
    return NextResponse.json({ error: "validation_error" }, { status: 422 });
  }

  try {
    const customer = await createCustomer(auth.ctx, {
      ...result.data,
      idempotencyKey: key,
    });
    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    return crmErrorResponse(error, "create_failed", 422);
  }
}
