import { prisma } from "@sangfor/db";
import { NextResponse } from "next/server";

import {
  PRIVILEGED_MFA_MAX_AGE_SECONDS,
  evaluateCapability,
  type AuthContext,
  type PersistedCompanyRoleAssignment,
} from "@sangfor/auth";

import { INTERNAL_CONTEXT_HEADER, verifyInternalContextHeader } from "@/lib/auth/persisted-session";
import { getRouteCapabilityDefinition, type RouteCapabilityKey } from "@/lib/auth/route-capability-registry";
import { findProjectMembership } from "@/lib/project-scope";

/**
 * U015/SEC-02a — the one DB-driven capability gate every route in the mechanical coverage set
 * calls (in addition to its existing `assertApiAccess`/`authorizeOperatorRequest` coarse gate).
 *
 * Identity/scope source: this reads ONLY the signed internal-context header the Web Proxy
 * (apps/web/src/proxy.ts) attaches after its own DB-backed `evaluatePersistedSessionFromRequest`
 * check already passed — never the request body, query string, or any client-supplied header. The
 * header carries no role/permission claim (see InternalContextPayload in persisted-session.ts);
 * role/permissions are recomputed fresh from UserCompanyRole/ProjectMember on every call.
 *
 * When the header is absent, this is a no-op (`null`, proceed). In a real deployment that is
 * unreachable for a non-public route: proxy.ts's matcher covers every non-static path and fails
 * closed (401/redirect) before a route handler runs unless the DB-backed check already passed and
 * set this header — so an absent header here means either a public-prefix request or a direct-call
 * unit test that invokes the exported route handler function without going through Next.js's
 * routing layer at all (the same premise `assertApiAccess`'s own internal-context fast path
 * documents), not a real unauthenticated request reaching this gate.
 */
export async function assertBusinessCapability(
  request: Request,
  routeKey: RouteCapabilityKey,
): Promise<NextResponse | null> {
  const definition = getRouteCapabilityDefinition(routeKey);
  if (!definition) {
    return NextResponse.json({ error: "forbidden", reason: "UNCLASSIFIED_ROUTE" }, { status: 403 });
  }
  if (definition.capabilityClass === "public" || definition.capabilityClass === "authenticated") return null;

  const context = verifyInternalContextHeader(request.headers.get(INTERNAL_CONTEXT_HEADER));
  if (!context) return null;

  const now = new Date();
  const needsProjectAssignment = definition.capabilityClass === "project-assigned";

  const [companyRoleRows, projectAssignmentRow] = await Promise.all([
    prisma.userCompanyRole.findMany({
      where: { userId: context.userId, companyId: context.companyId },
      select: { id: true, userId: true, companyId: true, role: true, status: true, validFrom: true, expiresAt: true, revokedAt: true },
    }),
    needsProjectAssignment ? findProjectMembership(context.userId, context.projectId) : Promise.resolve(null),
  ]);

  const evaluation = evaluateCapability({
    companyRoleAssignments: companyRoleRows as PersistedCompanyRoleAssignment[],
    projectAssignment: projectAssignmentRow,
    definition,
    now,
  });

  if (!evaluation.ok) {
    return NextResponse.json({ error: "forbidden", reason: evaluation.reason }, { status: 403 });
  }

  if (definition.capabilityClass === "privileged") {
    const mfaVerifiedAt = context.mfaVerifiedAt ? new Date(context.mfaVerifiedAt) : null;
    if (!mfaVerifiedAt) return NextResponse.json({ error: "forbidden", reason: "MFA_REQUIRED" }, { status: 403 });
    const ageSeconds = (now.getTime() - mfaVerifiedAt.getTime()) / 1000;
    if (ageSeconds < 0 || ageSeconds > PRIVILEGED_MFA_MAX_AGE_SECONDS) {
      return NextResponse.json({ error: "forbidden", reason: "MFA_STALE" }, { status: 403 });
    }
  }

  return null;
}

type CompanyScopeResourceResult<T> =
  | { readonly ok: true; readonly resource: T }
  | { readonly ok: false; readonly response: NextResponse };

export async function resolveBusinessCapabilityContext(
  identity: {
    userId: string;
    sessionId: string | null;
    tenantId: string;
    companyId: string;
    projectId: string;
    product: string;
  },
  routeKey: RouteCapabilityKey,
): Promise<{ ok: true; context: AuthContext } | { ok: false; response: NextResponse }> {
  const definition = getRouteCapabilityDefinition(routeKey);
  if (!definition || definition.capabilityClass === "public" || definition.capabilityClass === "authenticated") {
    return { ok: false, response: NextResponse.json({ error: "forbidden", reason: "INVALID_CONTEXT_ROUTE" }, { status: 403 }) };
  }
  const [companyRoleRows, projectAssignmentRow] = await Promise.all([
    prisma.userCompanyRole.findMany({
      where: { userId: identity.userId, companyId: identity.companyId },
      select: { id: true, userId: true, companyId: true, role: true, status: true, validFrom: true, expiresAt: true, revokedAt: true },
    }),
    definition.capabilityClass === "project-assigned"
      ? findProjectMembership(identity.userId, identity.projectId)
      : Promise.resolve(null),
  ]);
  const evaluation = evaluateCapability({
    companyRoleAssignments: companyRoleRows as PersistedCompanyRoleAssignment[],
    projectAssignment: projectAssignmentRow,
    definition,
    now: new Date(),
  });
  if (!evaluation.ok || !evaluation.role) {
    return { ok: false, response: NextResponse.json({ error: "forbidden", reason: evaluation.ok ? "ROLE_REQUIRED" : evaluation.reason }, { status: 403 }) };
  }
  return {
    ok: true,
    context: { ...identity, businessRole: evaluation.role, permissions: evaluation.permissions },
  };
}

/**
 * Resource-level helper matching apps/web/src/lib/project-scope.ts's established pattern for
 * project scope: the local-scope filter (`companyId`) is applied IN the same query predicate that
 * fetches the resource, never as a separate existence probe. A caller-supplied explicit
 * `requestedCompanyId` that conflicts with the session's own companyId is a 403 before any DB
 * call; an opaque foreign resource id that matches no row (because it belongs to a different
 * company) is a plain 404 — the query never reveals whether the id exists in another scope.
 */
export function enforceRequestedCompany(
  scopeCompanyId: string,
  requestedCompanyId: unknown,
): NextResponse | null {
  if (requestedCompanyId === undefined || requestedCompanyId === scopeCompanyId) return null;
  return NextResponse.json({ error: "forbidden", message: "Company scope does not match the signed session" }, { status: 403 });
}

function notFoundInScope(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
