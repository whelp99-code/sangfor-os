import type { AuthContext, AuthScope, BusinessRole } from './types';
import type { TokenPayload } from './token-manager';
import { BusinessRBAC } from './rbac';

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
  const businessRole = payload.businessRole ?? fallback?.businessRole ?? 'account_manager';
  const personaId = payload.personaId ?? fallback?.personaId;

  if (!tenantId || !companyId) return null;

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
