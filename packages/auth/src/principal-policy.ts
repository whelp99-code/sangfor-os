/**
 * U014/SEC-01 — principal/session lifecycle policy.
 *
 * Pure module: no Prisma/@sangfor/db import, ever (see the FORBIDDEN clause of the U014
 * dispatch). Web/API adapters query Prisma themselves, normalize the rows into
 * `PersistedSessionRecord`/`PersistedUserRecord`, and pass them through `evaluateSession`. This
 * keeps the actual authorization decision testable with zero DB/network dependency and byte-for-
 * byte identical between every adapter (Web Proxy, API middleware, route handlers).
 */

export type UserStatus = 'active' | 'disabled' | 'legacy_pending';

export interface PersistedUserRecord {
  readonly id: string;
  readonly status: UserStatus | string | null;
  readonly disabledAt: Date | null;
}

export interface PersistedSessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly projectId: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
  readonly mfaVerifiedAt: Date | null;
  readonly mfaMethod: string | null;
}

export interface SessionTokenScope {
  readonly sub: string;
  readonly jti: string;
  readonly tenantId?: string;
  readonly companyId?: string;
  readonly projectId?: string;
}

export interface SessionEvaluationRecord {
  readonly token: SessionTokenScope;
  readonly session: PersistedSessionRecord | null;
  readonly user: PersistedUserRecord | null;
}

export type SessionDenyReason =
  | 'NO_SESSION'
  | 'REVOKED'
  | 'EXPIRED'
  | 'USER_NOT_FOUND'
  | 'USER_NOT_ACTIVE'
  | 'SESSION_USER_MISMATCH'
  | 'SCOPE_MISMATCH'
  | 'MFA_REQUIRED'
  | 'MFA_STALE';

export type SessionEvaluation =
  | {
      readonly ok: true;
      /** The evaluated session's jti. Callers that mutate session state — an MFA
       *  step-up, a revoke — must act on exactly the session they verified. */
      readonly sessionId: string;
      readonly userId: string;
      readonly tenantId: string;
      readonly companyId: string;
      readonly projectId: string;
      readonly mfaVerifiedAt: Date | null;
    }
  | { readonly ok: false; readonly reason: SessionDenyReason };

/** The fixed privileged-role set from the U014 dispatch. Role-less sessions (no BusinessRole
 * resolved yet — U015 owns that) are never privileged by default. */
export const PRIVILEGED_BUSINESS_ROLES = Object.freeze([
  'ceo',
  'finance_manager',
  'security_officer',
  'system_admin',
] as const);
export type PrivilegedBusinessRole = (typeof PRIVILEGED_BUSINESS_ROLES)[number];

/** Recent-MFA age ceiling (seconds) a caller should pass as `requiredMfaAgeSeconds` before
 * exercising a privileged capability. */
export const PRIVILEGED_MFA_MAX_AGE_SECONDS = 300;

const PRIVILEGED_CAPABILITY_MARKERS = ['approve', 'role.manage', 'user.manage', 'system.admin', 'external-release'] as const;

export function isPrivilegedBusinessRole(role: string | null | undefined): boolean {
  return !!role && (PRIVILEGED_BUSINESS_ROLES as readonly string[]).includes(role);
}

export function isPrivilegedCapability(capability: string): boolean {
  return PRIVILEGED_CAPABILITY_MARKERS.some((marker) => capability.includes(marker));
}

export function isPrivilegedRequest(
  role: string | null | undefined,
  capabilities: readonly string[] | null | undefined = [],
): boolean {
  if (isPrivilegedBusinessRole(role)) return true;
  return (capabilities ?? []).some(isPrivilegedCapability);
}

function isActiveUser(user: PersistedUserRecord): boolean {
  return user.status === 'active' && user.disabledAt === null;
}

/**
 * Evaluates one persisted session against the identity/scope claims a verifier already pulled
 * out of a cryptographically-valid JWT. Never trusts the token's own opinion of `active`,
 * `disabled`, role, or MFA — every one of those comes from `session`/`user`, which the caller
 * fetched from the database moments ago. `requiredMfaAgeSeconds` is `null` for ordinary
 * (non-privileged) access; pass `PRIVILEGED_MFA_MAX_AGE_SECONDS` (or another explicit bound)
 * immediately before exercising a privileged capability — omitting it is a caller bug, not a
 * legitimate "skip MFA" path, since this function has no way to guess intent from `record` alone.
 */
export function evaluateSession(
  record: SessionEvaluationRecord,
  now: Date,
  requiredMfaAgeSeconds: number | null,
): SessionEvaluation {
  const { token, session, user } = record;

  if (!session || session.id !== token.jti) return { ok: false, reason: 'NO_SESSION' };
  if (session.revokedAt !== null) return { ok: false, reason: 'REVOKED' };
  if (now.getTime() >= session.expiresAt.getTime()) return { ok: false, reason: 'EXPIRED' };
  if (session.userId !== token.sub) return { ok: false, reason: 'SESSION_USER_MISMATCH' };

  const scopeMismatch =
    (token.tenantId !== undefined && token.tenantId !== session.tenantId) ||
    (token.companyId !== undefined && token.companyId !== session.companyId) ||
    (token.projectId !== undefined && token.projectId !== session.projectId);
  if (scopeMismatch) return { ok: false, reason: 'SCOPE_MISMATCH' };

  if (!user || user.id !== session.userId) return { ok: false, reason: 'USER_NOT_FOUND' };
  if (!isActiveUser(user)) return { ok: false, reason: 'USER_NOT_ACTIVE' };

  if (requiredMfaAgeSeconds !== null) {
    if (!session.mfaVerifiedAt) return { ok: false, reason: 'MFA_REQUIRED' };
    const ageSeconds = (now.getTime() - session.mfaVerifiedAt.getTime()) / 1000;
    if (ageSeconds < 0 || ageSeconds > requiredMfaAgeSeconds) return { ok: false, reason: 'MFA_STALE' };
  }

  return {
    ok: true,
    sessionId: session.id,
    userId: session.userId,
    tenantId: session.tenantId,
    companyId: session.companyId,
    projectId: session.projectId,
    mfaVerifiedAt: session.mfaVerifiedAt,
  };
}
