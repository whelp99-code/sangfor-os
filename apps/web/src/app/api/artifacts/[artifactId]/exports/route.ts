import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { issueDataExport, ArtifactAccessError, resolveCrmAuthContext } from "@sangfor/business";
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

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cacheHeaders });

    const body = await req.json().catch(() => ({}));
    const { artifactVersionId, approvalId, purpose } = body;

    if (!artifactVersionId || !approvalId || !purpose || typeof purpose !== "string" || purpose.trim().length === 0) {
      return NextResponse.json({ error: "artifactVersionId, approvalId, purpose required" }, { status: 400, headers: cacheHeaders });
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const result = await issueDataExport({
      authContext, artifactId, artifactVersionId,
      artifactContentHash: "",  // resolved server-side in full impl
      approvalId, purpose: purpose.trim(),
      idempotencyKey, requestId, now: new Date(),
    });

    return NextResponse.json(result, { status: 201, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof ArtifactAccessError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}
