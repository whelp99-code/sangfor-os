/**
 * U015/SEC-02a — canonical, DB-driven business-capability policy.
 *
 * Pure module: no Prisma/@sangfor/db import, ever (same rule as principal-policy.ts). Web/API
 * adapters (apps/web/src/lib/auth/authorization.ts, apps/api/src/middleware/business-authorization.ts)
 * fetch UserCompanyRole/ProjectMember rows via Prisma, normalize them into the
 * `PersistedCompanyRoleAssignment`/`PersistedProjectAssignment` shapes below, and pass them through
 * `evaluateCapability`. This keeps the actual authorization decision testable with zero DB/network
 * dependency and byte-for-byte identical between every adapter — the ONE canonical capability
 * registry the U015 dispatch requires (no policy duplication between web and API).
 *
 * Token/body/query role claims never reach this module at all: every input here is a caller-
 * supplied array of *already DB-fetched* assignment rows, never anything read off a JWT, request
 * body, or query string. A forged `businessRole`/`permissions` claim has no path into this
 * function's decision — the only role this module ever returns is one it found active in the rows
 * it was given.
 */

import type { BusinessPermission, BusinessRole } from './types';
import { BusinessRBAC } from './rbac';

const businessRbac = new BusinessRBAC();

/** The exact ten BusinessRole codes from ./types — the only values a new UserCompanyRole.role row
 * may take after the U015 migration watermark (pre-existing rows are grandfathered). */
export const BUSINESS_ROLE_CODES = Object.freeze([
  'ceo',
  'sales_manager',
  'account_manager',
  'presales_engineer',
  'solution_architect',
  'finance_manager',
  'delivery_engineer',
  'support_engineer',
  'security_officer',
  'system_admin',
] as const) satisfies readonly BusinessRole[];

const BUSINESS_ROLE_CODE_SET: ReadonlySet<string> = new Set(BUSINESS_ROLE_CODES);

export function isBusinessRoleCode(value: string | null | undefined): value is BusinessRole {
  return !!value && BUSINESS_ROLE_CODE_SET.has(value);
}

/** U024's policy-level high-risk predicate. It consumes U015's one canonical role vocabulary. */
export function isHighRiskRoleChange(fromRole: string | null | undefined, toRole: string | null | undefined): boolean {
  return isBusinessRoleCode(fromRole) && isBusinessRoleCode(toRole) && fromRole !== toRole;
}

/** Allowed non-null UserCompanyRole/ProjectMember lifecycle values. NULL and 'legacy_pending' are
 * both treated as inactive by every runtime — a migration adding this column never blanket-
 * activates a pre-existing row. */
export type AssignmentLifecycleStatus = 'active' | 'revoked' | 'expired' | 'legacy_pending';

interface LifecycleFields {
  readonly status: AssignmentLifecycleStatus | string | null;
  readonly validFrom: Date | null;
  readonly expiresAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface PersistedCompanyRoleAssignment extends LifecycleFields {
  readonly id: string;
  readonly userId: string;
  readonly companyId: string;
  readonly role: string;
}

export interface PersistedProjectAssignment extends LifecycleFields {
  readonly id: string;
  readonly userId: string;
  readonly projectId: string;
}

/** True only for a row that is explicitly `status: "active"`, not revoked, and — when set — within
 * its `validFrom`/`expiresAt` time bounds. NULL/"legacy_pending"/"revoked"/"expired" rows, or a row
 * outside its own time bounds despite carrying `status: "active"`, are never active. This is the
 * single fail-closed lifecycle gate shared by company-role and project-assignment evaluation. */
export function isActiveAssignment(assignment: LifecycleFields, now: Date): boolean {
  if (assignment.status !== 'active') return false;
  if (assignment.revokedAt !== null) return false;
  if (assignment.validFrom !== null && now.getTime() < assignment.validFrom.getTime()) return false;
  if (assignment.expiresAt !== null && now.getTime() >= assignment.expiresAt.getTime()) return false;
  return true;
}

export type CompanyRoleDenyReason = 'NO_ACTIVE_ROLE' | 'MULTIPLE_ACTIVE_ROLES';

export type CompanyRoleResolution =
  | { readonly ok: true; readonly role: BusinessRole; readonly assignment: PersistedCompanyRoleAssignment }
  | { readonly ok: false; readonly reason: CompanyRoleDenyReason };

/**
 * Resolves the single active company-role assignment for one (user, company) pair. Zero active
 * rows, or more than one simultaneously active row, both fail closed as a configuration error —
 * never a silent pick of "the first one" or a default role. A row whose `role` is not one of the
 * ten canonical BusinessRole codes is never eligible, even if its lifecycle is active (defends
 * against a hand-edited/legacy row carrying an out-of-policy role string).
 */
export function resolveActiveCompanyRole(
  assignments: readonly PersistedCompanyRoleAssignment[],
  now: Date,
): CompanyRoleResolution {
  const active = assignments.filter((a) => isActiveAssignment(a, now) && isBusinessRoleCode(a.role));
  if (active.length === 0) return { ok: false, reason: 'NO_ACTIVE_ROLE' };
  if (active.length > 1) return { ok: false, reason: 'MULTIPLE_ACTIVE_ROLES' };
  const [assignment] = active;
  return { ok: true, role: assignment.role as BusinessRole, assignment };
}

export function isActiveProjectAssignment(
  assignment: PersistedProjectAssignment | null | undefined,
  now: Date,
): boolean {
  return !!assignment && isActiveAssignment(assignment, now);
}

export function resolveCapabilities(role: BusinessRole): BusinessPermission[] {
  return businessRbac.getRolePermissions(role);
}

export function hasCapability(role: BusinessRole, permission: BusinessPermission): boolean {
  return businessRbac.hasPermission(role, permission);
}

/** Route registry classes from the U015 dispatch. `external-release` stays disabled — it is a
 * reserved classification for a feature flag this unit does not turn on. */
export type RouteCapabilityClass =
  | 'public'
  | 'authenticated'
  | 'company-scoped'
  | 'project-assigned'
  | 'owner-assigned'
  | 'privileged'
  | 'external-release';

export const ROUTE_CAPABILITY_CLASSES = Object.freeze([
  'public',
  'authenticated',
  'company-scoped',
  'project-assigned',
  'owner-assigned',
  'privileged',
  'external-release',
] as const) satisfies readonly RouteCapabilityClass[];

export interface RouteCapabilityDefinition {
  /** How this route entry point is classified. */
  readonly capabilityClass: RouteCapabilityClass;
  /** The BusinessPermission the resolved role must carry. Absent only for `public`/`authenticated`
   * classes, which require no specific capability beyond a valid identity. */
  readonly permission?: BusinessPermission;
}

export type CapabilityDenyReason =
  | CompanyRoleDenyReason
  | 'MISSING_PERMISSION'
  | 'PROJECT_ASSIGNMENT_REQUIRED'
  | 'PROJECT_ASSIGNMENT_INACTIVE'
  | 'DISABLED';

export type CapabilityEvaluation =
  | { readonly ok: true; readonly role: BusinessRole | null; readonly permissions: BusinessPermission[] }
  | { readonly ok: false; readonly reason: CapabilityDenyReason };

export interface EvaluateCapabilityInput {
  readonly companyRoleAssignments: readonly PersistedCompanyRoleAssignment[];
  readonly projectAssignment: PersistedProjectAssignment | null;
  readonly definition: RouteCapabilityDefinition;
  readonly now: Date;
}

/**
 * The one canonical decision function every adapter (web route handler, API middleware) calls.
 * Zero/multiple active company roles fail closed as a configuration error (never a default role,
 * never "pick the first"). A capability that requires project assignment additionally requires an
 * active ProjectMember row — missing, NULL/legacy_pending, expired, or revoked all deny. The
 * resolved role/permission set is recomputed from the rows given here on every call; nothing about
 * a prior token/session claim ever influences the result.
 */
export function evaluateCapability(input: EvaluateCapabilityInput): CapabilityEvaluation {
  const { companyRoleAssignments, projectAssignment, definition, now } = input;

  if (definition.capabilityClass === 'external-release') {
    return { ok: false, reason: 'DISABLED' };
  }

  // 'authenticated' needs only the identity the caller already resolved (a valid, active,
  // DB-backed session) — no company-role lookup, and therefore no possible NO_ACTIVE_ROLE denial
  // for a user who is legitimately authenticated but has no business role in any company yet.
  if (definition.capabilityClass === 'authenticated') {
    return { ok: true, role: null, permissions: [] };
  }

  const roleResolution = resolveActiveCompanyRole(companyRoleAssignments, now);
  if (!roleResolution.ok) return roleResolution;
  const { role } = roleResolution;
  const permissions = resolveCapabilities(role);

  if (definition.permission && !permissions.includes(definition.permission)) {
    return { ok: false, reason: 'MISSING_PERMISSION' };
  }

  if (definition.capabilityClass === 'project-assigned') {
    if (!isActiveProjectAssignment(projectAssignment, now)) {
      return { ok: false, reason: projectAssignment ? 'PROJECT_ASSIGNMENT_INACTIVE' : 'PROJECT_ASSIGNMENT_REQUIRED' };
    }
  }

  return { ok: true, role, permissions };
}
