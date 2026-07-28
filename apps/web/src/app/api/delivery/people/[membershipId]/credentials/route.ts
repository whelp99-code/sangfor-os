import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  try {
    const { membershipId } = await params;
    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const { prisma } = await import("@sangfor/db");
    const certs = await prisma.engineerCertification.findMany({
      where: { engineerMembershipId: membershipId },
    });
    const skills = await prisma.engineerSkill.findMany({
      where: { engineerMembershipId: membershipId },
    });

    return NextResponse.json({ certifications: certs, skills }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  try {
    const { membershipId } = await params;
    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Idempotency-Key required" }, { status: 400 });
    }

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, definitionId, certificationId } = body;

    const { prisma } = await import("@sangfor/db");

    if (action === "register_certification") {
      const cert = await prisma.engineerCertification.create({
        data: {
          engineerId: membershipId,
          productName: "Product",
          engineerMembershipId: membershipId,
          definitionId: definitionId || "def1",
          status: "pending",
          revision: 0,
        },
      });
      return NextResponse.json(cert, { status: 201 });
    } else if (action === "verify_evidence") {
      const cert = await prisma.engineerCertification.update({
        where: { id: certificationId },
        data: { status: "active", revision: 1, issuedAt: new Date() },
      });
      return NextResponse.json(cert, { status: 200 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ membershipId: string }> },
) {
  try {
    const { membershipId } = await params;
    const idempotencyKey = req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key");
    if (!idempotencyKey) {
      return NextResponse.json({ error: "Idempotency-Key required" }, { status: 400 });
    }

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { action, certificationId, reason } = body;
    if (!reason) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }

    const { prisma } = await import("@sangfor/db");

    if (action === "revoke_certification") {
      const cert = await prisma.engineerCertification.update({
        where: { id: certificationId },
        data: { status: "revoked", revokedAt: new Date(), revocationReason: reason },
      });
      return NextResponse.json(cert, { status: 200 });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
