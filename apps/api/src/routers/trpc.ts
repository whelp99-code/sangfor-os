/**
 * tRPC Router Setup
 * tRPC 라우터 초기화
 */

import { initTRPC, TRPCError } from '@trpc/server';
import { assertNoUntrustedScopeFields } from '@sangfor/auth';
import type { Context } from '../context';
import { FINANCE_ROLES } from '../middleware/finance-access';

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;
export const middleware = t.middleware;

// Auth middleware — userId가 없으면 401 반환
const authMiddleware = middleware(async ({ ctx, next, getRawInput }) => {
  if (!ctx.userId) {
    throw new TRPCError({
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Provide Bearer token or valid session cookie.',
    });
  }

  try {
    const rawInput = await getRawInput();
    assertNoUntrustedScopeFields(rawInput);
  } catch (error) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: error instanceof Error ? error.message : 'Invalid scoped identity fields',
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

// Role middleware — 하나 이상의 허용 역할 중 하나가 필요
// Accepts a single role (existing call sites: requireRole('admin')) or any
// iterable of roles (e.g. the FINANCE_ROLES set) without changing behavior
// for the single-role case.
export const requireRole = (roles: string | Iterable<string>) => {
  const allowed = new Set(typeof roles === 'string' ? [roles] : roles);
  return middleware(async ({ ctx, next }) => {
    if (!ctx.userId) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
    }
    if (!(ctx.userRole && allowed.has(ctx.userRole)) && ctx.userRole !== 'admin') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Role in [${[...allowed].join(', ')}] required`,
      });
    }
    return next({ ctx: { ...ctx, userId: ctx.userId, userRole: ctx.userRole! } });
  });
};

export const protectedProcedure = t.procedure.use(authMiddleware);
export const adminProcedure = t.procedure.use(authMiddleware).use(requireRole('admin'));

// Reused by every CFO tRPC sub-router (routers/cfo/*, except the public
// health.router.ts) so the tRPC finance surface enforces the exact same role
// set as the REST finance surface (middleware/finance-access.ts's
// financeAccessGuard) instead of drifting independently (P3).
export const financeProcedure = protectedProcedure.use(requireRole(FINANCE_ROLES));
