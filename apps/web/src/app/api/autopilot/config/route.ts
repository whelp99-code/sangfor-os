import { NextResponse } from "next/server";
import { prisma } from "@sangfor/db";
import {
  isAutopilotEnabled,
  setAutopilotEnabled,
  recordDecision,
  resolveDefaultProjectId,
} from "@sangfor/business";
import { apiError, assertApiAccess } from "@/lib/api-auth";
import { assertBusinessCapability } from "@/lib/auth/authorization";
import { requireRole } from "@/lib/auth/rbac";

const REVERSAL_WINDOW_DAYS = 7;

async function computeReversalRate7d(): Promise<number> {
  const since = new Date(Date.now() - REVERSAL_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const autoDecisions = await prisma.domainDecisionLog.findMany({
    where: { actor: "ai", actionType: "autopilot_approve", createdAt: { gte: since } },
    select: { caseRef: true, createdAt: true },
  });
  if (autoDecisions.length === 0) return 0;

  let reversed = 0;
  for (const d of autoDecisions) {
    if (!d.caseRef) continue;
    const laterRejection = await prisma.domainDecisionLog.findFirst({
      where: {
        caseRef: d.caseRef,
        actor: { in: ["human", "sales"] },
        outcome: "rejected",
        createdAt: { gt: d.createdAt },
      },
      select: { id: true },
    });
    if (laterRejection) reversed++;
  }
  return reversed / autoDecisions.length;
}

export async function GET() {
  try {
    const [enabled, policies, recentAutoDecisions, reversalRate7d] = await Promise.all([
      isAutopilotEnabled(),
      prisma.autonomyPolicy.findMany({
        orderBy: [{ domain: "asc" }, { decisionType: "asc" }],
        select: { domain: true, decisionType: true, mode: true, minAutonomy: true, minSamples: true },
      }),
      prisma.domainDecisionLog.findMany({
        where: { actor: "ai", actionType: "autopilot_approve" },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, caseRef: true, outcome: true, createdAt: true },
      }),
      computeReversalRate7d(),
    ]);
    return NextResponse.json({ enabled, policies, recentAutoDecisions, reversalRate7d });
  } catch (error) {
    return apiError("autopilot_config_get_failed", error, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = assertApiAccess(request);
  if (denied) return denied;
  const capabilityDenied = await assertBusinessCapability(request, "apps/web/src/app/api/autopilot/config/route.ts");
  if (capabilityDenied) return capabilityDenied;
  const forbidden = requireRole(request, ["admin", "operator"]);
  if (forbidden) return forbidden;
  try {
    const body = await request.json().catch(() => ({}));
    if (typeof body?.enabled !== "boolean") {
      return apiError("invalid_body", new Error("enabled must be a boolean"), {
        status: 400,
        message: "enabled must be a boolean",
      });
    }

    await setAutopilotEnabled(body.enabled);

    const projectId = await resolveDefaultProjectId();
    await recordDecision({
      projectId,
      domain: "platform",
      actor: "human",
      actionType: "autopilot_toggle",
      caseRef: "config:autopilot_enabled",
      outcome: "approved",
      output: { enabled: body.enabled },
    });

    return NextResponse.json({ enabled: body.enabled });
  } catch (error) {
    return apiError("autopilot_config_post_failed", error, { status: 500 });
  }
}
