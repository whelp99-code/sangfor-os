import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import { runSyntheticRemediationDrill, resolveCrmAuthContext } from "@sangfor/business";

export async function POST(req: NextRequest) {
  try {
    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const { scenario, idempotencyKey } = body;

    if (!scenario || !idempotencyKey) {
      return NextResponse.json({ error: "scenario and idempotencyKey required" }, { status: 400 });
    }

    const authContext = await resolveCrmAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });

    const result = await runSyntheticRemediationDrill({ scenario, authContext, idempotencyKey });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
