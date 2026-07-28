import {
  archiveProductFamily,
  archiveProductFamilySchema,
  getCatalogProductDetail,
  resolveCrmAuthContext,
  updateProductFamily,
  updateProductFamilySchema,
} from "@sangfor/business";
import { NextResponse } from "next/server";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

const SCOPE_FIELDS = new Set(["tenantId", "companyId", "projectId", "projectSlug", "actor", "role"]);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function forbiddenScope(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;
  if (Array.isArray(input)) return input.some(forbiddenScope);
  return Object.keys(input).some((key) => SCOPE_FIELDS.has(key) || forbiddenScope((input as Record<string, unknown>)[key]));
}

function getIdempotencyKey(request: Request, body?: Record<string, unknown>): string | null {
  const headerKey = request.headers.get("idempotency-key")?.trim();
  const bodyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const key = headerKey || bodyKey;
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
      response: catalogErrorResponse(error, "authorization_failed", 403),
    };
  }
}

function catalogErrorResponse(error: unknown, fallback: string, fallbackStatus: number) {
  if (
    error instanceof Error &&
    "httpStatus" in error &&
    typeof error.httpStatus === "number" &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return NextResponse.json({ error: error.code }, { status: error.httpStatus });
  }
  return apiError(fallback, error, { status: fallbackStatus });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const product = await getCatalogProductDetail(auth.ctx, id);
    if (!product) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({ product });
  } catch (error) {
    return catalogErrorResponse(error, "detail_failed", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: any;
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

  const key = getIdempotencyKey(request, body);
  if (!key) {
    return NextResponse.json({ error: "validation_error", message: "Missing or invalid idempotency key" }, { status: 422 });
  }

  const result = updateProductFamilySchema.safeParse({ ...body, idempotencyKey: key });
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

  try {
    const updated = await updateProductFamily(auth.ctx, id, result.data);
    return NextResponse.json({ product: updated });
  } catch (error) {
    return catalogErrorResponse(error, "update_failed", 409);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await resolveContext(request);
  if (!auth.ok) return auth.response;
  const { id } = await params;

  let body: any = {};
  try {
    body = await request.json();
  } catch {
    // Body optional if query or headers provided
  }

  if (forbiddenScope(body)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const key = getIdempotencyKey(request, body);
  if (!key) {
    return NextResponse.json({ error: "validation_error", message: "Missing or invalid idempotency key" }, { status: 422 });
  }

  const result = archiveProductFamilySchema.safeParse({ ...body, idempotencyKey: key });
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

  try {
    const archived = await archiveProductFamily(auth.ctx, id, result.data);
    return NextResponse.json({ product: archived });
  } catch (error) {
    return catalogErrorResponse(error, "archive_failed", 409);
  }
}
