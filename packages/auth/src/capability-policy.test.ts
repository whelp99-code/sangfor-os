import { describe, expect, it } from 'vitest';

import {
  BUSINESS_ROLE_CODES,
  evaluateCapability,
  isActiveAssignment,
  isActiveProjectAssignment,
  isBusinessRoleCode,
  resolveActiveCompanyRole,
  resolveCapabilities,
  type PersistedCompanyRoleAssignment,
  type PersistedProjectAssignment,
  type RouteCapabilityDefinition,
} from './capability-policy';

const NOW = new Date('2026-07-15T14:00:00.000Z');

function companyRole(overrides: Partial<PersistedCompanyRoleAssignment> = {}): PersistedCompanyRoleAssignment {
  return {
    id: 'ucr-1',
    userId: 'user-1',
    companyId: 'company-1',
    role: 'account_manager',
    status: 'active',
    validFrom: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function projectAssignment(overrides: Partial<PersistedProjectAssignment> = {}): PersistedProjectAssignment {
  return {
    id: 'pm-1',
    userId: 'user-1',
    projectId: 'project-1',
    status: 'active',
    validFrom: null,
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('BUSINESS_ROLE_CODES / isBusinessRoleCode', () => {
  it('exposes exactly the ten canonical roles', () => {
    expect(BUSINESS_ROLE_CODES).toEqual([
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
    ]);
  });

  it.each(['member', 'MEMBER', 'Account_Manager', '', 'owner'])('rejects out-of-policy role string "%s"', (value) => {
    expect(isBusinessRoleCode(value)).toBe(false);
  });

  it.each(BUSINESS_ROLE_CODES)('accepts canonical role "%s"', (value) => {
    expect(isBusinessRoleCode(value)).toBe(true);
  });
});

describe('isActiveAssignment — RED characterization (fail-closed lifecycle)', () => {
  it.each([[null], ['legacy_pending' as const], ['revoked' as const], ['expired' as const], ['superuser']])(
    'treats status %s as inactive',
    (status) => {
      expect(isActiveAssignment(companyRole({ status }), NOW)).toBe(false);
    },
  );

  it('treats an active row with a revokedAt timestamp as inactive', () => {
    expect(isActiveAssignment(companyRole({ status: 'active', revokedAt: NOW }), NOW)).toBe(false);
  });

  it('treats an active row whose validFrom is still in the future as inactive', () => {
    expect(isActiveAssignment(companyRole({ status: 'active', validFrom: new Date(NOW.getTime() + 1000) }), NOW)).toBe(false);
  });

  it('treats an active row exactly at/after its expiresAt as inactive', () => {
    expect(isActiveAssignment(companyRole({ status: 'active', expiresAt: NOW }), NOW)).toBe(false);
    expect(isActiveAssignment(companyRole({ status: 'active', expiresAt: new Date(NOW.getTime() - 1) }), NOW)).toBe(false);
  });

  it('treats an active row within validFrom/expiresAt bounds as active', () => {
    expect(
      isActiveAssignment(
        companyRole({ status: 'active', validFrom: new Date(NOW.getTime() - 1000), expiresAt: new Date(NOW.getTime() + 1000) }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe('resolveActiveCompanyRole — RED characterization', () => {
  it('denies zero active rows (no company role at all)', () => {
    expect(resolveActiveCompanyRole([], NOW)).toEqual({ ok: false, reason: 'NO_ACTIVE_ROLE' });
  });

  it('denies when every row is NULL/legacy_pending/revoked/expired', () => {
    const rows = [
      companyRole({ id: 'a', status: null }),
      companyRole({ id: 'b', status: 'legacy_pending' }),
      companyRole({ id: 'c', role: 'finance_manager', status: 'revoked', revokedAt: NOW }),
      companyRole({ id: 'd', role: 'ceo', status: 'expired' }),
    ];
    expect(resolveActiveCompanyRole(rows, NOW)).toEqual({ ok: false, reason: 'NO_ACTIVE_ROLE' });
  });

  it('denies a row whose role string is not one of the ten canonical codes, even if active', () => {
    const rows = [companyRole({ role: 'member', status: 'active' })];
    expect(resolveActiveCompanyRole(rows, NOW)).toEqual({ ok: false, reason: 'NO_ACTIVE_ROLE' });
  });

  it('denies two simultaneously active roles for the same company as a configuration error', () => {
    const rows = [
      companyRole({ id: 'a', role: 'account_manager', status: 'active' }),
      companyRole({ id: 'b', role: 'security_officer', status: 'active' }),
    ];
    expect(resolveActiveCompanyRole(rows, NOW)).toEqual({ ok: false, reason: 'MULTIPLE_ACTIVE_ROLES' });
  });

  it('resolves the sole active role, ignoring inactive siblings', () => {
    const rows = [
      companyRole({ id: 'old', role: 'account_manager', status: 'revoked', revokedAt: NOW }),
      companyRole({ id: 'current', role: 'finance_manager', status: 'active' }),
    ];
    const result = resolveActiveCompanyRole(rows, NOW);
    expect(result).toEqual({ ok: true, role: 'finance_manager', assignment: rows[1] });
  });

  it.each(BUSINESS_ROLE_CODES)('activates each of the ten synthetic roles independently (positive fixture)', (role) => {
    const result = resolveActiveCompanyRole([companyRole({ role, status: 'active' })], NOW);
    expect(result).toEqual({ ok: true, role, assignment: expect.objectContaining({ role }) });
  });
});

describe('isActiveProjectAssignment — RED characterization', () => {
  it('denies a missing assignment', () => {
    expect(isActiveProjectAssignment(null, NOW)).toBe(false);
    expect(isActiveProjectAssignment(undefined, NOW)).toBe(false);
  });

  it.each([[null], ['legacy_pending' as const]])('denies a %s project assignment', (status) => {
    expect(isActiveProjectAssignment(projectAssignment({ status }), NOW)).toBe(false);
  });

  it('denies an expired project assignment', () => {
    expect(isActiveProjectAssignment(projectAssignment({ status: 'active', expiresAt: NOW }), NOW)).toBe(false);
  });

  it('admits an active, in-bounds project assignment', () => {
    expect(isActiveProjectAssignment(projectAssignment({ status: 'active' }), NOW)).toBe(true);
  });
});

describe('evaluateCapability — RED characterization', () => {
  const companyScoped: RouteCapabilityDefinition = { capabilityClass: 'company-scoped', permission: 'customer.write' };
  const projectAssigned: RouteCapabilityDefinition = { capabilityClass: 'project-assigned', permission: 'opportunity.write' };
  const privileged: RouteCapabilityDefinition = { capabilityClass: 'privileged', permission: 'system.admin' };

  it('denies with NO_ACTIVE_ROLE for a role-less caller', () => {
    const result = evaluateCapability({ companyRoleAssignments: [], projectAssignment: null, definition: companyScoped, now: NOW });
    expect(result).toEqual({ ok: false, reason: 'NO_ACTIVE_ROLE' });
  });

  it('denies with MULTIPLE_ACTIVE_ROLES for conflicting active roles', () => {
    const rows = [companyRole({ id: 'a', role: 'account_manager' }), companyRole({ id: 'b', role: 'ceo' })];
    const result = evaluateCapability({ companyRoleAssignments: rows, projectAssignment: null, definition: companyScoped, now: NOW });
    expect(result).toEqual({ ok: false, reason: 'MULTIPLE_ACTIVE_ROLES' });
  });

  it('denies MISSING_PERMISSION for an active role that lacks the required capability', () => {
    const rows = [companyRole({ role: 'support_engineer' })];
    const result = evaluateCapability({ companyRoleAssignments: rows, projectAssignment: null, definition: companyScoped, now: NOW });
    expect(result).toEqual({ ok: false, reason: 'MISSING_PERMISSION' });
  });

  it('admits company-scoped access for an active role that carries the required capability', () => {
    const rows = [companyRole({ role: 'sales_manager' })];
    const result = evaluateCapability({ companyRoleAssignments: rows, projectAssignment: null, definition: companyScoped, now: NOW });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.role).toBe('sales_manager');
  });

  it('denies PROJECT_ASSIGNMENT_REQUIRED when a project-assigned capability has no ProjectMember row at all', () => {
    const rows = [companyRole({ role: 'sales_manager' })];
    const result = evaluateCapability({ companyRoleAssignments: rows, projectAssignment: null, definition: projectAssigned, now: NOW });
    expect(result).toEqual({ ok: false, reason: 'PROJECT_ASSIGNMENT_REQUIRED' });
  });

  it.each([[null], ['legacy_pending' as const]])(
    'denies PROJECT_ASSIGNMENT_INACTIVE for a %s ProjectMember row',
    (status) => {
      const rows = [companyRole({ role: 'sales_manager' })];
      const result = evaluateCapability({
        companyRoleAssignments: rows,
        projectAssignment: projectAssignment({ status }),
        definition: projectAssigned,
        now: NOW,
      });
      expect(result).toEqual({ ok: false, reason: 'PROJECT_ASSIGNMENT_INACTIVE' });
    },
  );

  it('denies PROJECT_ASSIGNMENT_INACTIVE for an expired ProjectMember row', () => {
    const rows = [companyRole({ role: 'sales_manager' })];
    const result = evaluateCapability({
      companyRoleAssignments: rows,
      projectAssignment: projectAssignment({ status: 'active', expiresAt: NOW }),
      definition: projectAssigned,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'PROJECT_ASSIGNMENT_INACTIVE' });
  });

  it('admits project-assigned access with an active role, capability, and active ProjectMember', () => {
    const rows = [companyRole({ role: 'sales_manager' })];
    const result = evaluateCapability({
      companyRoleAssignments: rows,
      projectAssignment: projectAssignment({ status: 'active' }),
      definition: projectAssigned,
      now: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('always denies the external-release class, regardless of role', () => {
    const rows = [companyRole({ role: 'ceo' })];
    const result = evaluateCapability({
      companyRoleAssignments: rows,
      projectAssignment: null,
      definition: { capabilityClass: 'external-release' },
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: 'DISABLED' });
  });

  it('ignores any extraneous fields smuggled onto the input objects (forged token/body role has no path in)', () => {
    const rows = [
      // Simulates a caller that (incorrectly) tried to smuggle a forged businessRole/permissions
      // pair onto the row it fetched from the DB — evaluateCapability only ever reads the fields
      // declared on PersistedCompanyRoleAssignment, so these extras are inert.
      { ...companyRole({ role: 'account_manager' }), businessRole: 'system_admin', permissions: ['system.admin'] } as PersistedCompanyRoleAssignment,
    ];
    const result = evaluateCapability({ companyRoleAssignments: rows, projectAssignment: null, definition: privileged, now: NOW });
    expect(result).toEqual({ ok: false, reason: 'MISSING_PERMISSION' });
  });

  it.each(BUSINESS_ROLE_CODES)('activates each of the ten roles for its own minimum permission (positive fixture)', (role) => {
    const [minimumPermission] = resolveCapabilities(role);
    expect(minimumPermission).toBeDefined();
    const rows = [companyRole({ role })];
    const result = evaluateCapability({
      companyRoleAssignments: rows,
      projectAssignment: null,
      definition: { capabilityClass: 'company-scoped', permission: minimumPermission },
      now: NOW,
    });
    expect(result).toEqual({ ok: true, role, permissions: resolveCapabilities(role) });
  });
});
