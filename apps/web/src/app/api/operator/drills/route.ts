import { NextResponse, type NextRequest } from "next/server";
import { evaluatePersistedSessionFromRequest } from "@/lib/auth/persisted-session";
import {
  isDrillScenario,
  resolveBusinessRoleDashboardAuthContext,
  runSyntheticRemediationDrill,
} from "@sangfor/business";

export async function POST(req: NextRequest) {
  try {
    const session = await evaluatePersistedSessionFromRequest(req);
    if (!session.ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = await req.json();
    const { scenario, idempotencyKey } = body;

    if (!isDrillScenario(scenario) || !idempotencyKey) {
      return NextResponse.json({ error: "scenario and idempotencyKey required" }, { status: 400 });
    }

    const authContext = await resolveBusinessRoleDashboardAuthContext({
      userId: session.userId, sessionId: null,
      tenantId: session.tenantId, companyId: session.companyId, projectId: session.projectId, product: "portal",
    });
    if (!authContext.permissions.includes("system.admin")) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const result = await runSyntheticRemediationDrill({ scenario, authContext, idempotencyKey });
    return NextResponse.json(result, { status: result.status === "SUCCESS" ? 200 : 503 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
