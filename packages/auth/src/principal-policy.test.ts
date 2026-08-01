import { describe, expect, it } from 'vitest';

import {
  PRIVILEGED_BUSINESS_ROLES,
  PRIVILEGED_MFA_MAX_AGE_SECONDS,
  evaluateSession,
  isPrivilegedBusinessRole,
  isPrivilegedCapability,
  isPrivilegedRequest,
  type PersistedSessionRecord,
  type PersistedUserRecord,
  type SessionEvaluationRecord,
} from './principal-policy';

const NOW = new Date('2026-07-15T14:00:00.000Z');

function token(overrides: Partial<SessionEvaluationRecord['token']> = {}): SessionEvaluationRecord['token'] {
  return { sub: 'user-1', jti: 'jti-1', tenantId: 't1', companyId: 'c1', projectId: 'p1', ...overrides };
}

function session(overrides: Partial<PersistedSessionRecord> = {}): PersistedSessionRecord {
  return {
    id: 'jti-1',
    userId: 'user-1',
    tenantId: 't1',
    companyId: 'c1',
    projectId: 'p1',
    issuedAt: new Date(NOW.getTime() - 60_000),
    expiresAt: new Date(NOW.getTime() + 60_000),
    revokedAt: null,
    mfaVerifiedAt: null,
    mfaMethod: null,
    ...overrides,
  };
}

function user(overrides: Partial<PersistedUserRecord> = {}): PersistedUserRecord {
  return { id: 'user-1', status: 'active', disabledAt: null, ...overrides };
}

describe('evaluateSession — RED characterization', () => {
  it('denies a signed token with no DB session', () => {
    const result = evaluateSession({ token: token(), session: null, user: null }, NOW, null);
    expect(result).toEqual({ ok: false, reason: 'NO_SESSION' });
  });

  it('denies a revoked session', () => {
    const result = evaluateSession(
      { token: token(), session: session({ revokedAt: new Date(NOW.getTime() - 1000) }), user: user() },
      NOW,
      null,
    );
    expect(result).toEqual({ ok: false, reason: 'REVOKED' });
  });

  it('denies an expired session', () => {
    const result = evaluateSession(
      { token: token(), session: session({ expiresAt: new Date(NOW.getTime() - 1) }), user: user() },
      NOW,
      null,
    );
    expect(result).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('denies a disabled user', () => {
    const result = evaluateSession(
      {
        token: token(),
        session: session(),
        user: user({ status: 'disabled', disabledAt: new Date(NOW.getTime() - 1000) }),
      },
      NOW,
      null,
    );
    expect(result).toEqual({ ok: false, reason: 'USER_NOT_ACTIVE' });
  });

  it.each([[null], ['legacy_pending' as const]])('denies a legacy %s user', (status) => {
    const result = evaluateSession(
      { token: token(), session: session(), user: user({ status }) },
      NOW,
      null,
    );
    expect(result).toEqual({ ok: false, reason: 'USER_NOT_ACTIVE' });
  });

  it('denies an unknown/garbage status value (fails closed, not open)', () => {
    const result = evaluateSession(
      { token: token(), session: session(), user: { id: 'user-1', status: 'superuser' as never, disabledAt: null } },
      NOW,
      null,
    );
    expect(result).toEqual({ ok: false, reason: 'USER_NOT_ACTIVE' });
  });

  it('denies when the DB user row is missing entirely', () => {
    const result = evaluateSession({ token: token(), session: session(), user: null }, NOW, null);
    expect(result).toEqual({ ok: false, reason: 'USER_NOT_FOUND' });
  });

  it('denies a session row whose own id does not match the token jti', () => {
    const result = evaluateSession(
      { token: token({ jti: 'jti-other' }), session: session(), user: user() },
      NOW,
      null,
    );
    expect(result).toEqual({ ok: false, reason: 'NO_SESSION' });
  });

  it('denies a session bound to a different user than the token sub', () => {
    const result = evaluateSession(
      { token: token({ sub: 'attacker' }), session: session(), user: user() },
      NOW,
      null,
    );
    expect(result).toEqual({ ok: false, reason: 'SESSION_USER_MISMATCH' });
  });

  it.each([
    ['tenantId', { tenantId: 'evil-tenant' }],
    ['companyId', { companyId: 'evil-company' }],
    ['projectId', { projectId: 'evil-project' }],
  ])('denies a JWT-vs-DB scope mismatch on %s', (_label, overrides) => {
    const result = evaluateSession(
      { token: token(overrides), session: session(), user: user() },
      NOW,
      null,
    );
    expect(result).toEqual({ ok: false, reason: 'SCOPE_MISMATCH' });
  });

  it('denies a privileged action with no MFA evidence at all', () => {
    const result = evaluateSession(
      { token: token(), session: session({ mfaVerifiedAt: null }), user: user() },
      NOW,
      PRIVILEGED_MFA_MAX_AGE_SECONDS,
    );
    expect(result).toEqual({ ok: false, reason: 'MFA_REQUIRED' });
  });

  it('denies a privileged action with stale MFA evidence', () => {
    const staleAt = new Date(NOW.getTime() - (PRIVILEGED_MFA_MAX_AGE_SECONDS + 1) * 1000);
    const result = evaluateSession(
      { token: token(), session: session({ mfaVerifiedAt: staleAt, mfaMethod: 'totp' }), user: user() },
      NOW,
      PRIVILEGED_MFA_MAX_AGE_SECONDS,
    );
    expect(result).toEqual({ ok: false, reason: 'MFA_STALE' });
  });

  it('denies a privileged action carrying a DIFFERENT session\'s fresh MFA evidence — the JTI for the token in hand has none', () => {
    // Two real sessions for the same user: session A (not presented) has fresh MFA; session B
    // (the one actually presented via the token/jti) has none. MFA evidence is bound to the
    // session it was recorded on, never borrowed across sessions.
    const sessionAWithFreshMfa = session({ id: 'jti-A', mfaVerifiedAt: NOW, mfaMethod: 'totp' });
    void sessionAWithFreshMfa; // exists only to document the scenario; never passed to evaluateSession
    const sessionBPresented = session({ id: 'jti-1', mfaVerifiedAt: null });
    const result = evaluateSession(
      { token: token({ jti: 'jti-1' }), session: sessionBPresented, user: user() },
      NOW,
      PRIVILEGED_MFA_MAX_AGE_SECONDS,
    );
    expect(result).toEqual({ ok: false, reason: 'MFA_REQUIRED' });
  });

  it('succeeds for an explicitly active, non-privileged session (trusted fixture)', () => {
    const result = evaluateSession({ token: token(), session: session(), user: user() }, NOW, null);
    expect(result).toEqual({
      ok: true,
      sessionId: 'jti-1',
      userId: 'user-1',
      tenantId: 't1',
      companyId: 'c1',
      projectId: 'p1',
      mfaVerifiedAt: null,
    });
  });

  it('succeeds for a privileged session with current MFA evidence bound to the same session (trusted fixture)', () => {
    const freshMfa = new Date(NOW.getTime() - 5_000);
    const result = evaluateSession(
      { token: token(), session: session({ mfaVerifiedAt: freshMfa, mfaMethod: 'totp' }), user: user() },
      NOW,
      PRIVILEGED_MFA_MAX_AGE_SECONDS,
    );
    expect(result).toEqual({
      ok: true,
      sessionId: 'jti-1',
      userId: 'user-1',
      tenantId: 't1',
      companyId: 'c1',
      projectId: 'p1',
      mfaVerifiedAt: freshMfa,
    });
  });

  it('treats MFA verified exactly at the age boundary as still fresh, and one second past as stale', () => {
    const atBoundary = new Date(NOW.getTime() - PRIVILEGED_MFA_MAX_AGE_SECONDS * 1000);
    const okResult = evaluateSession(
      { token: token(), session: session({ mfaVerifiedAt: atBoundary }), user: user() },
      NOW,
      PRIVILEGED_MFA_MAX_AGE_SECONDS,
    );
    expect(okResult.ok).toBe(true);

    const pastBoundary = new Date(atBoundary.getTime() - 1000);
    const staleResult = evaluateSession(
      { token: token(), session: session({ mfaVerifiedAt: pastBoundary }), user: user() },
      NOW,
      PRIVILEGED_MFA_MAX_AGE_SECONDS,
    );
    expect(staleResult).toEqual({ ok: false, reason: 'MFA_STALE' });
  });

  it('rejects MFA evidence timestamped in the future as stale, not as valid', () => {
    const future = new Date(NOW.getTime() + 60_000);
    const result = evaluateSession(
      { token: token(), session: session({ mfaVerifiedAt: future }), user: user() },
      NOW,
      PRIVILEGED_MFA_MAX_AGE_SECONDS,
    );
    expect(result).toEqual({ ok: false, reason: 'MFA_STALE' });
  });
});

describe('privileged role/capability policy', () => {
  it('exposes exactly the four privileged business roles', () => {
    expect(PRIVILEGED_BUSINESS_ROLES).toEqual(['ceo', 'finance_manager', 'security_officer', 'system_admin']);
  });

  it.each(PRIVILEGED_BUSINESS_ROLES)('treats %s as privileged', (role) => {
    expect(isPrivilegedBusinessRole(role)).toBe(true);
  });

  it.each(['account_manager', 'sales_manager', 'presales_engineer', null, undefined, ''])(
    'treats %s as non-privileged',
    (role) => {
      expect(isPrivilegedBusinessRole(role)).toBe(false);
    },
  );

  it.each(['quote.approve_discount', 'finance.approve_margin', 'role.manage', 'user.manage', 'system.admin', 'external-release.publish'])(
    'treats capability "%s" as privileged',
    (capability) => {
      expect(isPrivilegedCapability(capability)).toBe(true);
    },
  );

  it.each(['customer.read', 'opportunity.write', 'support.escalate'])(
    'treats capability "%s" as non-privileged',
    (capability) => {
      expect(isPrivilegedCapability(capability)).toBe(false);
    },
  );

  it('isPrivilegedRequest is true when the role is privileged even with no capabilities listed', () => {
    expect(isPrivilegedRequest('ceo', [])).toBe(true);
  });

  it('isPrivilegedRequest is true when a non-privileged role carries a privileged capability', () => {
    expect(isPrivilegedRequest('account_manager', ['finance.approve_margin'])).toBe(true);
  });

  it('isPrivilegedRequest is false for a non-privileged role with only non-privileged capabilities', () => {
    expect(isPrivilegedRequest('account_manager', ['customer.read', 'opportunity.write'])).toBe(false);
  });

  it('isPrivilegedRequest is false for a role-less session with no capabilities (until U015 resolves DB roles)', () => {
    expect(isPrivilegedRequest(null, [])).toBe(false);
    expect(isPrivilegedRequest(undefined, undefined)).toBe(false);
  });
});
