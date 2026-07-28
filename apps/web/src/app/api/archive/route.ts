import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { listArchivedEntities, ArchiveError, resolveCrmAuthContext, type ArchiveEntityType } from "@sangfor/business";

export async function GET(req: NextRequest) {
  const cacheHeaders = { "Cache-Control": "no-store" };
  try {
    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cacheHeaders });

    const searchParams = req.nextUrl.searchParams;
    const entityType = (searchParams.get("entityType") || undefined) as ArchiveEntityType | undefined;
    const limit = searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined;

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const result = await listArchivedEntities({ authContext, entityType, limit });
    return NextResponse.json(result, { status: 200, headers: cacheHeaders });
  } catch (err: any) {
    if (err instanceof ArchiveError) {
      return NextResponse.json({ code: err.code, error: err.message }, { status: err.httpStatus, headers: cacheHeaders });
    }
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500, headers: cacheHeaders });
  }
}
