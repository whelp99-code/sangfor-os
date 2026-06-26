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

function findUntrustedScopeFieldsInValue(input: unknown, path = ''): string[] {
  if (!input || typeof input !== 'object') return [];

  if (Array.isArray(input)) {
    return input.flatMap((entry, index) => findUntrustedScopeFieldsInValue(entry, `${path}[${index}]`));
  }

  return Object.entries(input as Record<string, unknown>).flatMap(([key, value]) => {
    const fieldPath = path ? `${path}.${key}` : key;
    const ownMatch = SCOPED_BODY_FIELDS.has(key) ? [fieldPath] : [];
    return [...ownMatch, ...findUntrustedScopeFieldsInValue(value, fieldPath)];
  });
}
