/**
 * Authentication Middleware
 * JWT Bearer 토큰 기반 인증 (x-user-id 헤더 미신뢰)
 */

import type { Request, Response, NextFunction } from 'express';
import { getTokenManager } from '@sangfor/auth';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await getTokenManager().verifyToken(token);

    if (payload) {
      req.user = {
        id: payload.sub,
        email: payload.sub,
        name: payload.sub,
        role: 'USER',
      };
      next();
      return;
    }
  }

  // 명시적 bypass 플래그 (개발 전용, 프로덕션에서는 사용 금지)
  if (process.env.AUTH_BYPASS_ENABLED === '1' && process.env.NODE_ENV === 'development') {
    req.user = { id: 'dev-user', email: 'dev@aios.local', name: 'Developer', role: 'ADMIN' };
    next();
    return;
  }

  res.status(401).json({ error: 'Authentication required' });
}
