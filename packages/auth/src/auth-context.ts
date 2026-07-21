import type { AuthContext, AuthScope, BusinessRole } from './types';
import type { TokenPayload } from './token-manager';
import { BusinessRBAC } from './rbac';
import { isPrivilegedRequest } from './principal-policy';

const SCOPED_BODY_FIELDS = new Set([
  'tenantId',
  'tenant_id',
  'companyId',
  'company_id',
  'approverPersonaId',
  'approver_persona_id',
  'personaId',
  'persona_id',
]);

const CALLER_IDENTITY_FIELDS: ReadonlySet<string> = new Set([
  'approvedBy',
  'actorId',
  'requestedBy',
  'requester',
  'approver',
  'approverId',
  'approverPersonaId',
  'personaId',
]);

const businessRbac = new BusinessRBAC();

export interface AuthContextFallback {
  tenantId: string;
  companyId: string;
  businessRole?: BusinessRole;
  personaId?: string;
}

export function createAuthContextFromTokenPayload(
  payload: TokenPayload,
  fallback?: AuthContextFallback,
): AuthContext | null {
  const tenantId = payload.tenantId ?? fallback?.tenantId;
  const companyId = payload.companyId ?? fallback?.companyId;
  // U015/SEC-02a: no default. Unlike tenantId/companyId, businessRole has no safe placeholder — a
  // caller that cannot supply an explicit one (from a trusted server-side fallback) gets `null`
  // here, same as missing tenant/company scope, rather than a silently-granted role. Real
  // authorization decisions never actually trust this field's value anyway (business-authorization
  // recomputes role/permissions from the DB — see @sangfor/auth's capability-policy.ts); this
  // resolution only has to stay structurally valid for callers that still read AuthContext.businessRole.
  const businessRole = payload.businessRole ?? fallback?.businessRole;
  const personaId = payload.personaId ?? fallback?.personaId;

  if (!tenantId || !companyId || !businessRole) return null;

  return {
    userId: payload.sub,
    sessionId: payload.jti ?? null,
    product: payload.product,
    tenantId,
    companyId,
    personaId,
    businessRole,
    permissions: businessRbac.getRolePermissions(businessRole),
  };
}

export function createDevelopmentAuthContext(overrides?: Partial<AuthScope> & { userId?: string; sessionId?: string | null }): AuthContext {
  const businessRole = overrides?.businessRole ?? 'system_admin';
  return {
    userId: overrides?.userId ?? 'dev-user',
    sessionId: overrides?.sessionId ?? 'dev-session',
    tenantId: overrides?.tenantId ?? 'dev-tenant',
    companyId: overrides?.companyId ?? 'dev-company',
    personaId: overrides?.personaId ?? 'dev-persona',
    businessRole,
    permissions: businessRbac.getRolePermissions(businessRole),
    product: 'portal',
  };
}

/** U014/SEC-01: whether `ctx` (already resolved from a persisted, DB-checked session — see
 * @sangfor/auth's principal-policy.ts) may exercise a privileged capability. Callers still owe
 * their own fresh-MFA check via `evaluateSession(..., PRIVILEGED_MFA_MAX_AGE_SECONDS)`; this only
 * answers "is the role/permission set itself privileged". */
export function isPrivilegedAuthContext(ctx: AuthContext): boolean {
  return isPrivilegedRequest(ctx.businessRole, ctx.permissions);
}

export function findUntrustedScopeFields(input: unknown): string[] {
  return findUntrustedScopeFieldsInValue(input);
}

export function assertNoUntrustedScopeFields(input: unknown): void {
  const fields = findUntrustedScopeFields(input);
  if (fields.length > 0) {
    throw new Error(`Do not accept scoped identity fields from request body: ${fields.join(', ')}`);
  }
}

export function findCallerIdentityConflicts(
  input: unknown,
  principalId: string,
): string[] {
  return findCallerIdentityConflictsInValue(input, principalId);
}

export function stripCallerIdentityFields(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown>;
export function stripCallerIdentityFields(input: unknown): unknown;
export function stripCallerIdentityFields(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(stripCallerIdentityFields);
  if (!isUnknownRecord(input)) return input;
  return Object.fromEntries(
    Object.entries(input)
      .filter(([key]) => !CALLER_IDENTITY_FIELDS.has(key))
      .map(([key, value]) => [key, stripCallerIdentityFields(value)]),
  );
}

function findUntrustedScopeFieldsInValue(input: unknown, path = ''): string[] {
  if (Array.isArray(input)) {
    return input.flatMap((entry, index) => findUntrustedScopeFieldsInValue(entry, `${path}[${index}]`));
  }

  if (!isUnknownRecord(input)) return [];

  return Object.entries(input).flatMap(([key, value]) => {
    const fieldPath = path ? `${path}.${key}` : key;
    const ownMatch = SCOPED_BODY_FIELDS.has(key) ? [fieldPath] : [];
    return [...ownMatch, ...findUntrustedScopeFieldsInValue(value, fieldPath)];
  });
}

function findCallerIdentityConflictsInValue(
  input: unknown,
  principalId: string,
  path = '',
): string[] {
  if (Array.isArray(input)) {
    return input.flatMap((entry, index) =>
      findCallerIdentityConflictsInValue(entry, principalId, `${path}[${index}]`),
    );
  }

  if (!isUnknownRecord(input)) return [];

  return Object.entries(input).flatMap(([key, value]) => {
    const fieldPath = path ? `${path}.${key}` : key;
    const ownConflict =
      CALLER_IDENTITY_FIELDS.has(key) && value !== principalId ? [fieldPath] : [];
    return [
      ...ownConflict,
      ...findCallerIdentityConflictsInValue(value, principalId, fieldPath),
    ];
  });
}

function isUnknownRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object';
}
