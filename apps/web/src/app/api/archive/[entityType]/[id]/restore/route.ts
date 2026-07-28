import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { restoreArchivedEntity, ArchiveError, resolveCrmAuthContext, type ArchiveEntityType } from "@sangfor/business";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ entityType: string; id: string }> },
) {
  const { entityType, id } = await params;
  const cacheHeaders = { "Cache-Control": "no-store" };

  try {
    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cacheHeaders });

    const body = await req.json().catch(() => ({}));
    const { expectedVersion, restoreStatus } = body;

    if (!expectedVersion) {
      return NextResponse.json({ error: "expectedVersion required" }, { status: 400, headers: cacheHeaders });
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const result = await restoreArchivedEntity({
      authContext,
      entityType: entityType as ArchiveEntityType,
      id,
      expectedVersion,
      restoreStatus,
    });

    return NextResponse.json(result, { status: 200, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof ArchiveError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}
