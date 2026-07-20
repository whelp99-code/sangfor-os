/**
 * Authentication Middleware
 * JWT Bearer 토큰 기반 인증 (x-user-id 헤더 미신뢰)
 */

import type { Request, Response, NextFunction } from 'express';
import {
  assertNoUntrustedScopeFields,
  createAuthContextFromTokenPayload,
  createDevelopmentAuthContext,
  getTokenManager,
  verifySessionJwt,
  type AuthContext,
  type ProductName,
  type TokenPayload,
} from '@sangfor/auth';
import { getUserJwtConfig } from '@sangfor/config';

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
    personaId: claims.personaId,
    iat: claims.iat,
    exp: claims.exp,
    jti: claims.jti,
  };
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
async function verifyBearerToken(token: string): Promise<TokenPayload | null> {
  try {
    const claims = verifySessionJwt(token, getUserJwtConfig());
    if (claims) return toTokenPayload(claims);
  } catch {
    // USER_JWT_* misconfiguration must not silently enable the legacy path
    // below to become a stealth "always available" bypass; fail through to
    // the same fallback attempt any other verification miss would reach.
  }
  return getTokenManager().verifyToken(token);
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await verifyBearerToken(token);

    if (payload) {
      const authContext = createAuthContextFromTokenPayload(payload, developmentScopeFallback());
      if (authContext) {
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
