import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export async function POST(
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
    const { action, ownerAssignmentId, reason } = body;
    if (action !== "create" || !ownerAssignmentId || !reason) {
      return NextResponse.json({ error: "action, ownerAssignmentId, and reason required" }, { status: 400 });
    }

    const { prisma } = await import("@sangfor/db");
    const escalation = await prisma.vendorEscalation.create({
      data: {
        caseId: supportCaseId,
        vendor: "Sangfor",
        status: "draft",
        revision: 0,
        reason,
      },
    });

    return NextResponse.json(escalation, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
