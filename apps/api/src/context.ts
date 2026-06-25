/**
 * tRPC Context
 * 요청별 컨텍스트 생성 (인증 포함)
 */

import type { CreateNextContextOptions } from '@trpc/server/adapters/next';
import { getTokenManager } from '@sangfor/auth';

export interface Context {
  userId: string | null;
  userRole: string | null;
  sessionId: string | null;
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
      return {
        userId: payload.sub,
        userRole: 'user',
        sessionId: payload.jti,
      };
    }
    return {
      userId: null,
      userRole: null,
      sessionId: null,
    };
  }

  // 2. 쿠키에서 세션 확인 (NextAuth)
  const cookie = req.headers.cookie || '';
  const sessionToken = cookie
    .split(';')
    .find(c => c.trim().startsWith('next-auth.session-token='))
    ?.split('=')[1];

  if (sessionToken) {
    return {
      userId: 'session-user',
      userRole: 'user',
      sessionId: sessionToken.slice(0, 8),
    };
  }

  // 3. 인증 없음
  return {
    userId: null,
    userRole: null,
    sessionId: null,
  };
}
