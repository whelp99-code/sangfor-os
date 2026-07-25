import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { consumeDataExport, ArtifactAccessError, resolveCrmAuthContext } from "@sangfor/business";
import { randomUUID } from "node:crypto";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ exportId: string }> },
) {
  const { exportId } = await params;
  const requestId = randomUUID();
  const cacheHeaders = { "Cache-Control": "no-store" };

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Capability ")) {
      return NextResponse.json({ error: "Authorization: Capability <token> required" }, { status: 401, headers: cacheHeaders });
    }
    const capabilityHeader = authHeader.slice("Capability ".length);

    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cacheHeaders });

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const result = await consumeDataExport({
      authContext, exportId, capabilityHeader, requestId, now: new Date(),
    });

    return NextResponse.json(result, { status: 200, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof ArtifactAccessError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}
