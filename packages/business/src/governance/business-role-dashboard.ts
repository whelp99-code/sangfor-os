import {
  isBusinessRoleCode,
  isActiveProjectAssignment,
  resolveActiveCompanyRole,
  resolveCapabilities,
  type BusinessRole,
  type AuthContext,
} from "@sangfor/auth";
import { withRlsTransaction } from "@sangfor/db";

export const BUSINESS_ROLE_DASHBOARD_LANDINGS: Record<BusinessRole, string> = {
  ceo: "/dashboard",
  sales_manager: "/deals",
  account_manager: "/home",
  presales_engineer: "/deals?view=presales",
  solution_architect: "/registry/rules",
  finance_manager: "/cfo/dashboard",
  delivery_engineer: "/delivery",
  support_engineer: "/support",
  security_officer: "/security",
  system_admin: "/operator/workflows",
};

export type BusinessRoleDashboardErrorCode =
  | "INVALID_BUSINESS_ROLE"
  | "DASHBOARD_ROLE_FORBIDDEN";

export class BusinessRoleDashboardError extends Error {
  constructor(
    readonly code: BusinessRoleDashboardErrorCode,
    readonly httpStatus: 400 | 403,
  ) {
    super(code);
    this.name = "BusinessRoleDashboardError";
  }
}

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
  requestedRole?: string;
}

export type VerifiedBusinessRoleIdentity = Pick<
  AuthContext,
  "userId" | "sessionId" | "tenantId" | "companyId" | "projectId" | "product"
>;

function rlsScope(ctx: AuthContext) {
  return { tenantId: ctx.tenantId, companyId: ctx.companyId, projectId: ctx.projectId, level: "PROJECT" as const };
}

export async function resolveBusinessRoleDashboardAuthContext(
  identity: VerifiedBusinessRoleIdentity,
): Promise<AuthContext> {
  return withRlsTransaction(rlsScope(identity as AuthContext), async (tx) => {
    const [assignments, projectAssignment] = await Promise.all([
      tx.userCompanyRole.findMany({
        where: { userId: identity.userId, companyId: identity.companyId },
        select: {
          id: true,
          userId: true,
          companyId: true,
          role: true,
          status: true,
          validFrom: true,
          expiresAt: true,
          revokedAt: true,
        },
      }),
      tx.projectMember.findFirst({
        where: { userId: identity.userId, projectId: identity.projectId },
        select: {
          id: true,
          userId: true,
          projectId: true,
          status: true,
          validFrom: true,
          expiresAt: true,
          revokedAt: true,
        },
      }),
    ]);
    const role = resolveActiveCompanyRole(assignments, new Date());
    if (!role.ok || !isActiveProjectAssignment(projectAssignment, new Date())) {
      throw new BusinessRoleDashboardError("DASHBOARD_ROLE_FORBIDDEN", 403);
    }
    return {
      ...identity,
      businessRole: role.role,
      permissions: resolveCapabilities(role.role),
    };
  });
}

export async function getBusinessRoleDashboard(input: BusinessRoleDashboardInput): Promise<BusinessRoleDashboardPayload> {
  const { authContext, requestedRole } = input;
  if (!isBusinessRoleCode(authContext.businessRole)) {
    throw new BusinessRoleDashboardError("INVALID_BUSINESS_ROLE", 400);
  }

  const role = requestedRole ?? authContext.businessRole;
  if (!isBusinessRoleCode(role)) {
    throw new BusinessRoleDashboardError("INVALID_BUSINESS_ROLE", 400);
  }

  if (role !== authContext.businessRole) {
    // Executive operators (ceo) carry system.admin and need to open the
    // security/sales/delivery hub panels, which request a fixed lens role.
    // Identity still comes from the session; this only unlocks the lens.
    const hasExecutiveAuthority = authContext.permissions.includes("system.admin");
    if (!hasExecutiveAuthority) {
      throw new BusinessRoleDashboardError("DASHBOARD_ROLE_FORBIDDEN", 403);
    }
  }

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
      landing: BUSINESS_ROLE_DASHBOARD_LANDINGS[role],
      metrics,
      asOf: now,
    };
  });
}
