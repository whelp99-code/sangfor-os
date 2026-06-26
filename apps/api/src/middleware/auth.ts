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
  type AuthContext,
} from '@sangfor/auth';

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

function developmentScopeFallback() {
  if (process.env.NODE_ENV === 'production') return undefined;
  return {
    tenantId: process.env.DEFAULT_TENANT_ID ?? 'dev-tenant',
    companyId: process.env.DEFAULT_COMPANY_ID ?? 'dev-company',
    businessRole: 'account_manager' as const,
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

export function rejectUntrustedScopeFields(req: Request, res: Response, next: NextFunction): void {
  try {
    assertNoUntrustedScopeFields(req.body);
    next();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid scoped identity fields' });
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await getTokenManager().verifyToken(token);

    if (payload) {
      const authContext = createAuthContextFromTokenPayload(payload, developmentScopeFallback());
      if (authContext) {
        attachAuthContext(req, authContext);
        next();
        return;
      }
    }
  }

  // 명시적 bypass 플래그 (개발 전용, 프로덕션에서는 사용 금지)
  if (process.env.AUTH_BYPASS_ENABLED === '1' && process.env.NODE_ENV === 'development') {
    attachAuthContext(req, createDevelopmentAuthContext({ userId: 'dev-user', businessRole: 'system_admin' }));
    next();
    return;
  }

  res.status(401).json({ error: 'Authentication required' });
}
