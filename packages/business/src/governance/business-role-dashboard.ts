import type { BusinessRole, AuthContext } from "@sangfor/auth";
import { withRlsTransaction } from "@sangfor/db";

export type MetricStatus = "MEASURED" | "PARTIAL" | "UNKNOWN" | "COLLECTING" | "SOURCE_UNAVAILABLE";

export interface MetricCell<T = number | string | null> {
  state: MetricStatus;
  value: T;
  unit?: string;
  asOf?: string;
  reason?: string;
  provenance: string[];
}

export interface BusinessRoleDashboardPayload {
  role: BusinessRole;
  landing: string;
  metrics: Record<string, MetricCell>;
  asOf: string;
}

export interface BusinessRoleDashboardInput {
  authContext: AuthContext;
  requestedRole?: BusinessRole;
}

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

export async function getBusinessRoleDashboard(input: BusinessRoleDashboardInput): Promise<BusinessRoleDashboardPayload> {
  const { authContext, requestedRole } = input;
  const role = requestedRole ?? authContext.businessRole;
  const scope = rlsScope(authContext);
  const now = new Date().toISOString();

  return withRlsTransaction(scope, async (tx) => {
    const metrics: Record<string, MetricCell> = {};

    if (role === "ceo" || role === "sales_manager") {
      const oppCount = await tx.opportunity.count();
      metrics["activeOpportunities"] = {
        state: "MEASURED",
        value: oppCount,
        unit: "건",
        asOf: now,
        provenance: ["Opportunity.count"],
      };
    } else {
      metrics["activeOpportunities"] = {
        state: "UNKNOWN",
        value: null,
        reason: "역할 권한 범위 밖 메트릭",
        provenance: [],
      };
    }

    // Telemetry metric: unintegrated source returns SOURCE_UNAVAILABLE rather than 0
    metrics["systemTelemetry"] = {
      state: "SOURCE_UNAVAILABLE",
      value: null,
      reason: "외부 텔레메트리 연동 준비 중",
      provenance: ["TelemetryGateway"],
    };

    return {
      role,
      landing: role === "ceo" ? "/dashboard" : role === "system_admin" ? "/operator/workflows" : "/home",
      metrics,
      asOf: now,
    };
  });
}
