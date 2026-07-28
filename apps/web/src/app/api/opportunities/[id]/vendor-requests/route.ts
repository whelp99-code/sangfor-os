import { NextResponse, type NextRequest } from "next/server";
import {
  createVendorRequest,
  VendorRequestError,
  resolveCrmAuthContext,
} from "@sangfor/business";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: opportunityId } = await params;
    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
    }

    const body = await req.json();
    const { requestType, details } = body;

    if (!requestType || (requestType !== "special_discount" && requestType !== "demo_license")) {
      return NextResponse.json({ error: "Invalid requestType" }, { status: 400 });
    }

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId,
      sessionId: null,
      tenantId: session.tenantId,
      companyId: session.companyId,
      projectId: session.projectId,
      product: "portal",
    });

    const result = await createVendorRequest({
      authContext,
      opportunityId,
      requestType,
      details,
      idempotencyKey,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    if (err instanceof VendorRequestError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
