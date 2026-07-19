import { describe, expect, it } from 'vitest';

import {
  assertNoUntrustedScopeFields,
  createAuthContextFromTokenPayload,
  findUntrustedScopeFields,
} from './auth-context';
import * as authContextModule from './auth-context';
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

describe('caller identity conflict containment', () => {
  it('reports only caller identity fields that differ from the authenticated principal', () => {
    // Given
    const findCallerIdentityConflicts: unknown = Reflect.get(
      authContextModule,
      'findCallerIdentityConflicts',
    );
    const input = {
      equal: {
        approvedBy: 'principal-1',
        actorId: 'principal-1',
        requestedBy: 'principal-1',
        requester: 'principal-1',
        approver: 'principal-1',
        approverId: 'principal-1',
        approverPersonaId: 'principal-1',
        personaId: 'principal-1',
      },
      conflicting: {
        approvedBy: 'spoofed-principal',
        actorId: 'spoofed-principal',
        requestedBy: 'spoofed-principal',
        requester: 'spoofed-principal',
        approver: 'spoofed-principal',
        approverId: 'spoofed-principal',
        approverPersonaId: 'spoofed-principal',
        personaId: 'spoofed-principal',
      },
    };

    // When
    expect(findCallerIdentityConflicts).toBeTypeOf('function');
    if (typeof findCallerIdentityConflicts !== 'function') return;
    const conflicts: unknown = findCallerIdentityConflicts(input, 'principal-1');

    // Then
    expect(conflicts).toEqual([
      'conflicting.approvedBy',
      'conflicting.actorId',
      'conflicting.requestedBy',
      'conflicting.requester',
      'conflicting.approver',
      'conflicting.approverId',
      'conflicting.approverPersonaId',
      'conflicting.personaId',
    ]);
  });

  it('strips every recursive caller identity field while preserving other values', () => {
    // Given
    const stripCallerIdentityFields: unknown = Reflect.get(
      authContextModule,
      'stripCallerIdentityFields',
    );
    const input = {
      keep: 'value',
      approvedBy: 'principal-1',
      nested: {
        actorId: 'principal-1',
        requestedBy: 'principal-1',
        items: [
          { requester: 'principal-1', approver: 'principal-1' },
          { approverId: 'principal-1', approverPersonaId: 'principal-1', personaId: 'principal-1' },
        ],
      },
    };

    // When
    expect(stripCallerIdentityFields).toBeTypeOf('function');
    if (typeof stripCallerIdentityFields !== 'function') return;
    const sanitized: unknown = stripCallerIdentityFields(input);

    // Then
    expect(sanitized).toEqual({ keep: 'value', nested: { items: [{}, {}] } });
  });
});
