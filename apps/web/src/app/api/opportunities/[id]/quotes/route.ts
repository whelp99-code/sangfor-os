import { apiError, assertApiAccess } from "@/lib/api-auth";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import {
  QuoteServiceError,
  createQuoteVersion,
  listQuoteVersions,
  resolveCrmAuthContext,
} from "@sangfor/business";

const SCOPE_FIELDS = new Set(["tenantId", "companyId", "projectId", "projectSlug"]);
const FORGED_MONEY_FIELDS = new Set([
  "totalRevenue",
  "totalCost",
  "marginPct",
  "requiresApproval",
  "contentHash",
  "approvalStatus",
]);

function containsScopeField(input: unknown): boolean {
  return (
    !!input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).some((key) => SCOPE_FIELDS.has(key))
  );
}

function containsForgedMoneyField(input: unknown): boolean {
  return (
    !!input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).some((key) => FORGED_MONEY_FIELDS.has(key))
  );
}

function containsFulfillmentSnapshot(input: unknown): boolean {
  return (
    !!input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    Object.keys(input).some((key) => key.startsWith("fulfillmentSnapshot"))
  );
}

function validateUnknownFields(input: unknown): string[] {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    return [];
  }

  const allowedFields = new Set([
    "opportunityId",
    "expectedCurrentQuoteId",
    "expectedCurrentContentHash",
    "currency",
    "lines",
    "idempotencyKey",
  ]);

  return Object.keys(input).filter((key) => !allowedFields.has(key));
}

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> },
) {
  const accessError = assertApiAccess(req);
  if (accessError) return accessError;

  const session = await evaluatePersistedSessionFromRequest(req);
  if (!session.ok) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const ctx = await resolveCrmAuthContext({
    userId: session.userId,
    sessionId: null,
    tenantId: session.tenantId,
    companyId: session.companyId,
    projectId: session.projectId,
    product: "portal",
  });
  const { id } = await props.params;

  try {
    const body = await req.json();

    if (containsScopeField(body)) {
      return Response.json(
        { error: "FORBIDDEN_SCOPE" },
        { status: 403 },
      );
    }

    if (containsForgedMoneyField(body) || containsFulfillmentSnapshot(body)) {
      return Response.json(
        { error: "FORBIDDEN_FORGED_FIELD" },
        { status: 403 },
      );
    }

    const unknownFields = validateUnknownFields(body);
    if (unknownFields.length > 0) {
      return Response.json(
        { error: "VALIDATION_ERROR", message: `Unknown fields: ${unknownFields.join(", ")}` },
        { status: 422 },
      );
    }

    const quote = await createQuoteVersion(ctx, {
      opportunityId: id,
      expectedCurrentQuoteId: body.expectedCurrentQuoteId ?? undefined,
      expectedCurrentContentHash: body.expectedCurrentContentHash ?? undefined,
      currency: body.currency,
      lines: body.lines,
    });

    return Response.json({ quote }, { status: 201 });
  } catch (error) {
    if (error instanceof QuoteServiceError) {
      const sanitizedMessage = error.message.includes("ID")
        ? "Quote creation failed"
        : error.message;
      return apiError(error.code, new Error(sanitizedMessage), {
        status: error.httpStatus,
      });
    }
    return apiError("INTERNAL_ERROR", error, { status: 500 });
  }
}

export async function GET(
  req: Request,
  props: { params: Promise<{ id: string }> },
) {
  const accessError = assertApiAccess(req);
  if (accessError) return accessError;

  const session = await evaluatePersistedSessionFromRequest(req);
  if (!session.ok) {
    return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const ctx = await resolveCrmAuthContext({
    userId: session.userId,
    sessionId: null,
    tenantId: session.tenantId,
    companyId: session.companyId,
    projectId: session.projectId,
    product: "portal",
  });
  const { id } = await props.params;

  try {
    const { searchParams } = new URL(req.url);
    const first = searchParams.get("first");
    const firstValue = first === null ? undefined : Number(first);

    if (
      first !== null &&
      (!Number.isInteger(firstValue) || (firstValue ?? 0) < 1 || (firstValue ?? 101) > 100)
    ) {
      return Response.json({ error: "VALIDATION_ERROR" }, { status: 422 });
    }

    const allowedQueryFields = new Set(["first", "cursor"]);
    for (const key of searchParams.keys()) {
      if (!allowedQueryFields.has(key)) {
        return Response.json({ error: "VALIDATION_ERROR" }, { status: 422 });
      }
    }

    const quotes = await listQuoteVersions(ctx, id, { first: firstValue });
    return Response.json({ quotes }, { status: 200 });
  } catch (error) {
    if (error instanceof QuoteServiceError) {
      return apiError(error.code, error, { status: error.httpStatus });
    }
    return apiError("INTERNAL_ERROR", error, { status: 500 });
  }
}
