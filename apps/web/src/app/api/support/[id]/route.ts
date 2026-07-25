import { NextResponse, type NextRequest } from "next/server";
import { transitionSupportCaseStatus, SupportCaseError, resolveCrmAuthContext } from "@sangfor/business";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { prisma } = await import("@sangfor/db");
    const sc = await prisma.supportCase.findUnique({
      where: { id },
      include: { slaSnapshot: true },
    });

    if (!sc) {
      return NextResponse.json({ error: "Support case not found" }, { status: 404 });
    }

    return NextResponse.json(sc, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: supportCaseId } = await params;
    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Idempotency-Key header is required" }, { status: 400 });
    }

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, expectedRevision } = body;
    if (!action || expectedRevision === undefined) {
      return NextResponse.json({ error: "action and expectedRevision required" }, { status: 400 });
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId,
      sessionId: null,
      tenantId: session.tenantId,
      companyId: session.companyId,
      projectId: session.projectId,
      product: "portal",
    });

    const result = await transitionSupportCaseStatus({
      authContext,
      supportCaseId,
      action,
      expectedRevision,
      idempotencyKey,
      now: new Date(),
    });

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    if (err instanceof SupportCaseError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
