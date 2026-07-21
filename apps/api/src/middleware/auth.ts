/**
 * Authentication Middleware
 * JWT Bearer 토큰 기반 인증 (x-user-id 헤더 미신뢰)
 */

import type { Request, Response, NextFunction } from 'express';
import {
  assertNoUntrustedScopeFields,
  createAuthContextFromTokenPayload,
  createDevelopmentAuthContext,
  evaluateSession,
  getTokenManager,
  verifySessionJwt,
  type AuthContext,
  type ProductName,
  type SessionEvaluation,
  type SessionJwtClaims,
  type TokenPayload,
} from '@sangfor/auth';
import { getUserJwtConfig } from '@sangfor/config';
import { prisma } from '@sangfor/db';
import { resolveBusinessAuthorizationFromDb } from './business-authorization';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: string;
  authContext: AuthContext;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      authContext?: AuthContext;
    }
  }
}

// Non-production only. The USER_JWT_* session contract carries identity/scope
// IDs only — no businessRole claim ever comes from the wire (U013: a legacy
// role claim must never be authoritative; U015 resolves BusinessRole from the
// DB). Until then, any cryptographically verified session gets this fixed,
// env-gated default in dev/test only; production returns `undefined` so a
// token without explicit tenant/company scope yields no auth context at all.
function developmentScopeFallback() {
  if (process.env.NODE_ENV === 'production') return undefined;
  return {
    tenantId: process.env.DEFAULT_TENANT_ID ?? 'dev-tenant',
    companyId: process.env.DEFAULT_COMPANY_ID ?? 'dev-company',
    projectId: process.env.DEFAULT_PROJECT_ID ?? 'dev-project',
    businessRole: 'system_admin' as const,
  };
}

function attachAuthContext(req: Request, authContext: AuthContext): void {
  req.authContext = authContext;
  req.user = {
    id: authContext.userId,
    email: authContext.userId,
    name: authContext.userId,
    role: authContext.businessRole,
    authContext,
  };
}

export function isLocalMockAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const localRuntime = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  return localRuntime && env.AUTH_PROFILE === 'local_mock' && env.AUTH_BYPASS_ENABLED === '1';
}

export function rejectUntrustedScopeFields(req: Request, res: Response, next: NextFunction): void {
  try {
    assertNoUntrustedScopeFields(req.body);
    next();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid scoped identity fields' });
  }
}

function toTokenPayload(claims: NonNullable<ReturnType<typeof verifySessionJwt>>): TokenPayload {
  return {
    sub: claims.sub,
    product: (claims.product as ProductName | undefined) ?? 'portal',
    scopes: [],
    tenantId: claims.tenantId,
    companyId: claims.companyId,
    projectId: claims.projectId,
    personaId: claims.personaId,
    iat: claims.iat,
    exp: claims.exp,
    jti: claims.jti,
  };
}

// U014/SEC-01: resolves the claims' `jti` to a live AuthSession row for an explicitly `active`
// User via the same pure `evaluateSession` decision @sangfor/web's Proxy uses — never trusts the
// token's own opinion of active/disabled. `requiredMfaAgeSeconds: null` here means this call site
// enforces ordinary (non-privileged) persisted-session validity only; a future privileged-route
// guard passes a bound explicitly (see PRIVILEGED_MFA_MAX_AGE_SECONDS in @sangfor/auth).
async function loadPersistedSessionEvaluation(claims: SessionJwtClaims): Promise<SessionEvaluation> {
  const session = await prisma.authSession.findUnique({ where: { id: claims.jti } });
  const user = session
    ? await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, status: true, disabledAt: true } })
    : null;
  return evaluateSession(
    {
      token: { sub: claims.sub, jti: claims.jti, tenantId: claims.tenantId, companyId: claims.companyId, projectId: claims.projectId },
      session,
      user,
    },
    new Date(),
    null,
  );
}

// U013/SEC-01: the canonical USER_JWT_* session contract (shared byte-for-byte
// with the Web Proxy/route guard) is tried first and, on any structural or
// business-rule failure, is a hard reject for THAT token — it never silently
// downgrades. Only a token that isn't a session-JWT at all (never reaches a
// non-null `verifySessionJwt` result) additionally gets a chance through the
// pre-existing, unrelated TokenManager mechanism (product-scoped OAuth-style
// tokens; still NEXTAUTH_SECRET-backed, unchanged by this unit — see the note
// atop packages/auth/src/token-manager.ts for why that boundary is fixed).
// This does not weaken the new contract and does not grant TokenManager
// tokens any capability they didn't already have before U013.
//
// U014/SEC-01: once `claims` is non-null (the token IS a session-JWT), this is now a two-stage
// hard reject, never a downgrade: cryptographic validity alone no longer admits the request — the
// persisted-session DB check below must also pass. A DB failure while checking an otherwise-valid
// session-JWT denies outright rather than silently falling through to the legacy TokenManager path.
interface BearerVerification {
  readonly payload: TokenPayload;
  // 'session' means the token resolved through the DB-backed persisted-session check above (a
  // real userId with a real AuthSession row) — the only source U015 recomputes businessRole for.
  // 'legacy-token-manager' is the pre-existing, unrelated TokenManager path (see the U013 note
  // above); it is untouched by U015, exactly as it was untouched by U013/U014.
  readonly source: 'session' | 'legacy-token-manager';
}

async function verifyBearerToken(token: string): Promise<BearerVerification | null> {
  let claims: SessionJwtClaims | null = null;
  try {
    claims = verifySessionJwt(token, getUserJwtConfig());
  } catch {
    claims = null;
  }

  if (claims) {
    let evaluation: SessionEvaluation;
    try {
      evaluation = await loadPersistedSessionEvaluation(claims);
    } catch {
      return null;
    }
    return evaluation.ok ? { payload: toTokenPayload(claims), source: 'session' } : null;
  }

  const legacyPayload = await getTokenManager().verifyToken(token);
  return legacyPayload ? { payload: legacyPayload, source: 'legacy-token-manager' } : null;
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const verification = await verifyBearerToken(token);

    if (verification) {
      const authContext = createAuthContextFromTokenPayload(verification.payload, developmentScopeFallback());
      if (authContext) {
        // U015/SEC-02a: production has no dev-fallback businessRole (developmentScopeFallback
        // returns undefined there), so a real deployment must resolve the DB-verified session's
        // role here — never defaulted, never trusted from the token. Non-production keeps today's
        // byte-identical dev/test posture (the fallback above already supplies a role), so no DB
        // round trip runs there and every existing NODE_ENV=test/development fixture is unaffected.
        if (verification.source === 'session' && process.env.NODE_ENV === 'production') {
          const evaluation = await resolveBusinessAuthorizationFromDb(authContext.userId, authContext.companyId, new Date());
          if (!evaluation.ok || !evaluation.role) {
            res.status(403).json({ error: 'forbidden', reason: evaluation.ok ? 'NO_ACTIVE_ROLE' : evaluation.reason });
            return;
          }
          attachAuthContext(req, { ...authContext, businessRole: evaluation.role, permissions: evaluation.permissions });
          next();
          return;
        }
        attachAuthContext(req, authContext);
        next();
        return;
      }
    }
  }

  if (isLocalMockAuthEnabled()) {
    attachAuthContext(req, createDevelopmentAuthContext({ userId: 'dev-user', businessRole: 'system_admin' }));
    next();
    return;
  }

  res.status(401).json({ error: 'Authentication required' });
}
