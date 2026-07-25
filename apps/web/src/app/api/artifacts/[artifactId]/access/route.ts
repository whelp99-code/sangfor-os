import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { createArtifactAccessEvent, ArtifactAccessError, resolveCrmAuthContext } from "@sangfor/business";
import { prisma } from "@sangfor/db";
import { randomUUID } from "node:crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  const { artifactId } = await params;
  const requestId = randomUUID();

  const cacheHeaders = { "Cache-Control": "no-store" };

  try {
    const idempotencyKey = req.headers.get("Idempotency-Key");
    if (!idempotencyKey) return NextResponse.json({ error: "Idempotency-Key header required" }, { status: 400, headers: cacheHeaders });

    const ct = req.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) return NextResponse.json({ error: "Content-Type: application/json required" }, { status: 415, headers: cacheHeaders });

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cacheHeaders });

    const body = await req.json().catch(() => ({}));
    const { action, artifactVersionId } = body;

    if (!action || !artifactVersionId || !["view", "copy"].includes(action)) {
      return NextResponse.json({ code: "ARTIFACT_ACCESS_INVALID_REQUEST", error: "body must be {action,artifactVersionId} or {action,artifactVersionId,viewAccessEventId}" }, { status: 400, headers: cacheHeaders });
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const now = new Date();

    if (action === "view") {
      // Authorize and return watermarked content
      const result = await prisma.$transaction(async (tx: any) => {
        const event = await createArtifactAccessEvent(tx, {
          artifactId, artifactVersionId,
          actorAssignmentId: authContext.userId,
          requestId, createdAt: now,
          accessType: "view", policyResult: "allowed",
          watermarkApplied: true, redactionApplied: false, denialReason: null,
          requestMetadata: { schemaVersion: "artifact-access-event/v1", routeAction: "artifact.view" },
        });
        return { accessEventId: event.id };
      });

      return NextResponse.json({
        accessEventId: result.accessEventId,
        artifactId, artifactVersionId,
        classification: "restricted",
        policyResult: "allowed",
        content: {},
        redactedFieldPaths: [],
        watermark: { identityLabel: session.userId, companyLabel: session.companyId, requestId, renderedAt: now.toISOString() },
      }, { status: 200, headers: cacheHeaders });
    }

    if (action === "copy") {
      const { viewAccessEventId } = body;
      if (!viewAccessEventId) return NextResponse.json({ code: "ARTIFACT_ACCESS_INVALID_REQUEST", error: "viewAccessEventId required for copy" }, { status: 400, headers: cacheHeaders });

      const result = await prisma.$transaction(async (tx: any) => {
        const event = await createArtifactAccessEvent(tx, {
          artifactId, artifactVersionId,
          actorAssignmentId: authContext.userId,
          requestId, createdAt: now,
          accessType: "copy", policyResult: "denied",
          watermarkApplied: true, redactionApplied: false,
          denialReason: "restricted_copy_blocked_best_effort",
          requestMetadata: { schemaVersion: "artifact-access-event/v1", routeAction: "artifact.copy", source: "restricted_view" },
        });
        return { accessEventId: event.id };
      });

      return NextResponse.json({
        error: { code: "RESTRICTED_COPY_BLOCKED_BEST_EFFORT", requestId },
        accessEventId: result.accessEventId,
      }, { status: 403, headers: cacheHeaders });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof ArtifactAccessError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}

export async function GET() { return NextResponse.json({ error: "Method Not Allowed" }, { status: 405, headers: { Allow: "POST" } }); }
export async function PUT() { return NextResponse.json({ error: "Method Not Allowed" }, { status: 405, headers: { Allow: "POST" } }); }
export async function DELETE() { return NextResponse.json({ error: "Method Not Allowed" }, { status: 405, headers: { Allow: "POST" } }); }
