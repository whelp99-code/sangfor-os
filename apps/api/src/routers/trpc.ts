/**
 * tRPC Router Setup
 * tRPC 라우터 초기화
 */

import { initTRPC, TRPCError } from '@trpc/server';
import type { Context } from '../context';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

// Auth middleware — userId가 없으면 401 반환
const authMiddleware = middleware(async ({ ctx, next }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Provide Bearer token or valid session cookie.',
    });
  }
  return next({
    ctx: {
      ...ctx,
      userId: ctx.userId,  // non-null after guard
      userRole: ctx.userRole || 'user',
    },
  });
});

// Role middleware — 특정 역할 필요
export const requireRole = (role: string) =>
  middleware(async ({ ctx, next }) => {
    if (!ctx.userId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    if (ctx.userRole !== role && ctx.userRole !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: `Role '${role}' required` });
    }
    return next({ ctx: { ...ctx, userId: ctx.userId, userRole: ctx.userRole! } });
  });

export const protectedProcedure = t.procedure.use(authMiddleware);
export const adminProcedure = t.procedure.use(authMiddleware).use(requireRole('admin'));
