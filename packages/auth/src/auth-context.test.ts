import { describe, expect, it } from 'vitest';

import {
  assertNoUntrustedScopeFields,
  createAuthContextFromTokenPayload,
  findUntrustedScopeFields,
} from './auth-context';
import type { TokenPayload } from './token-manager';

const basePayload: TokenPayload = {
  sub: 'user-1',
  product: 'portal',
  scopes: [],
  iat: 1,
  exp: 2,
  jti: 'session-1',
};

describe('AuthContext foundation helpers', () => {
  it('creates scoped auth context from trusted token claims', () => {
    const context = createAuthContextFromTokenPayload({
      ...basePayload,
      tenantId: 'tenant-1',
      companyId: 'company-1',
      personaId: 'persona-1',
      businessRole: 'finance_manager',
    });

    expect(context).toMatchObject({
      userId: 'user-1',
      tenantId: 'tenant-1',
      companyId: 'company-1',
      personaId: 'persona-1',
      businessRole: 'finance_manager',
    });
    expect(context?.permissions).toContain('finance.approve_margin');
  });

  it('returns null when no trusted tenant/company scope is available', () => {
    expect(createAuthContextFromTokenPayload(basePayload)).toBeNull();
  });

  it('uses server fallback scope without reading request body scope fields', () => {
    const context = createAuthContextFromTokenPayload(basePayload, {
      tenantId: 'server-tenant',
      companyId: 'server-company',
      businessRole: 'sales_manager',
    });

    expect(context).toMatchObject({
      tenantId: 'server-tenant',
      companyId: 'server-company',
      businessRole: 'sales_manager',
    });
    expect(context?.permissions).toContain('quote.approve_discount');
  });

  it('detects scoped identity fields in request body payloads', () => {
    expect(
      findUntrustedScopeFields({
        name: 'Quote approval',
        tenantId: 'forged-tenant',
        company_id: 'forged-company',
        approverPersonaId: 'forged-persona',
      }),
    ).toEqual(['tenantId', 'company_id', 'approverPersonaId']);
  });

  it('detects nested scoped identity fields in request body payloads', () => {
    expect(
      findUntrustedScopeFields({
        safe: true,
        filters: [{ companyId: 'forged-company' }],
        approval: { approver_persona_id: 'forged-persona' },
      }),
    ).toEqual(['filters[0].companyId', 'approval.approver_persona_id']);
  });

  it('throws before scoped identity fields can be trusted from request body', () => {
    expect(() => assertNoUntrustedScopeFields({ companyId: 'forged-company' })).toThrow(
      'Do not accept scoped identity fields from request body: companyId',
    );
  });
});
