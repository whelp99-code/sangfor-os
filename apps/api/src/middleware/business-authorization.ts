import type { NextFunction, Request, Response } from 'express';
import { prisma } from '@sangfor/db';
import {
  evaluateCapability,
  type BusinessPermission,
  type CapabilityEvaluation,
  type PersistedCompanyRoleAssignment,
  type PersistedProjectAssignment,
  type RouteCapabilityDefinition,
} from '@sangfor/auth';

/**
 * U015/SEC-02a — the DB-driven business-role recompute for apps/api. Queries UserCompanyRole for
 * exactly one (userId, companyId) pair and feeds the rows through @sangfor/auth's
 * `evaluateCapability` — the identical pure decision function apps/web's authorization.ts uses, so
 * web and API never diverge on what "active role" or "has this capability" means. Never reads a
 * role/permission claim from anywhere but the DB rows fetched here.
 */
export async function resolveBusinessAuthorizationFromDb(
  userId: string,
  companyId: string,
  now: Date,
  definition: RouteCapabilityDefinition = { capabilityClass: 'company-scoped' },
  projectId?: string,
): Promise<CapabilityEvaluation> {
  const [companyRoleRows, projectAssignmentRow] = await Promise.all([
    prisma.userCompanyRole.findMany({
      where: { userId, companyId },
      select: { id: true, userId: true, companyId: true, role: true, status: true, validFrom: true, expiresAt: true, revokedAt: true },
    }),
    definition.capabilityClass === 'project-assigned' && projectId
      ? prisma.projectMember.findUnique({
          where: { projectId_userId: { projectId, userId } },
          select: { id: true, userId: true, projectId: true, status: true, validFrom: true, expiresAt: true, revokedAt: true },
        })
      : Promise.resolve(null),
  ]);

  return evaluateCapability({
    companyRoleAssignments: companyRoleRows as PersistedCompanyRoleAssignment[],
    projectAssignment: projectAssignmentRow as PersistedProjectAssignment | null,
    definition,
    now,
  });
}

/**
 * Express middleware form: requires `req.authContext` to already carry a server-resolved
 * userId/companyId (set by an earlier auth step — never trusted from this middleware's own
 * request parsing), recomputes businessRole/permissions from the DB, and overwrites both
 * `req.authContext` and `req.user.role` with the DB-verified values — replacing whatever a
 * token/dev-fallback previously set there, so every downstream guard reads DB truth.
 */
export function requireBusinessCapability(permission?: BusinessPermission) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.authContext) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const definition: RouteCapabilityDefinition = permission
      ? { capabilityClass: 'company-scoped', permission }
      : { capabilityClass: 'company-scoped' };

    const evaluation = await resolveBusinessAuthorizationFromDb(
      req.authContext.userId,
      req.authContext.companyId,
      new Date(),
      definition,
    );

    if (!evaluation.ok) {
      res.status(403).json({ error: 'forbidden', reason: evaluation.reason });
      return;
    }

    if (evaluation.role) {
      req.authContext = { ...req.authContext, businessRole: evaluation.role, permissions: evaluation.permissions };
      if (req.user) {
        req.user = { ...req.user, role: evaluation.role, authContext: req.authContext };
      }
    }

    next();
  };
}
