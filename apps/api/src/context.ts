/**
 * tRPC Context
 * 요청별 컨텍스트 생성 (인증 포함)
 */

import type { CreateNextContextOptions } from '@trpc/server/adapters/next';
import {
  createAuthContextFromTokenPayload,
  createDevelopmentAuthContext,
  getTokenManager,
  type AuthContext,
} from '@sangfor/auth';

export interface Context {
  userId: string | null;
  userRole: string | null;
  sessionId: string | null;
  authContext: AuthContext | null;
  tenantId: string | null;
  companyId: string | null;
  businessRole: AuthContext['businessRole'] | null;
}

function anonymousContext(): Context {
  return {
    userId: null,
    userRole: null,
    sessionId: null,
    authContext: null,
    tenantId: null,
    companyId: null,
    businessRole: null,
  };
}

function contextFromAuth(authContext: AuthContext): Context {
  return {
    userId: authContext.userId,
    userRole: authContext.businessRole,
    sessionId: authContext.sessionId,
    authContext,
    tenantId: authContext.tenantId,
    companyId: authContext.companyId,
    businessRole: authContext.businessRole,
  };
}

function developmentScopeFallback() {
  if (process.env.NODE_ENV === 'production') return undefined;
  return {
    tenantId: process.env.DEFAULT_TENANT_ID ?? 'dev-tenant',
    companyId: process.env.DEFAULT_COMPANY_ID ?? 'dev-company',
    businessRole: 'account_manager' as const,
  };
}

/**
 * tRPC 컨텍스트 생성
 * - Authorization 헤더에서 Bearer 토큰 추출 및 JWT 검증
 * - 쿠키에서 세션 확인
 * - X-User-Id 헤더는 절대 신뢰하지 않음 (보안)
 */
export async function createTRPCContext(opts: CreateNextContextOptions): Promise<Context> {
  const { req } = opts;

  // 1. Authorization 헤더에서 JWT 토큰 검증
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const tokenManager = getTokenManager();
    const payload = await tokenManager.verifyToken(token);
    if (payload) {
      const authContext = createAuthContextFromTokenPayload(payload, developmentScopeFallback());
      if (authContext) return contextFromAuth(authContext);
    }
    return anonymousContext();
  }

  // 2. 쿠키에서 세션 확인 (NextAuth)
  const cookie = req.headers.cookie || '';
  const sessionToken = cookie
    .split(';')
    .find(c => c.trim().startsWith('next-auth.session-token='))
    ?.split('=')[1];

  if (sessionToken) {
    return contextFromAuth(
      createDevelopmentAuthContext({
        userId: 'session-user',
        sessionId: sessionToken.slice(0, 8),
        businessRole: 'account_manager',
      }),
    );
  }

  // 3. 인증 없음
  return anonymousContext();
}
