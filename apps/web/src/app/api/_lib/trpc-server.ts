import { initTRPC, TRPCError } from '@trpc/server';
import type { OpenApiMeta } from 'trpc-to-openapi';
import { NextRequest } from 'next/server';
import { assertApiAccess } from '@/lib/api-auth';

interface CreateContextOptions {
  req: NextRequest;
}

export const createContext = async (opts: CreateContextOptions) => {
  const authResult = assertApiAccess(opts.req);
  // assertApiAccess returns null if allowed, NextResponse(401) if denied
  const authenticated = authResult === null;
  return { authenticated };
};

export type Context = Awaited<ReturnType<typeof createContext>>;

export const t = initTRPC.meta<OpenApiMeta>().context<Context>().create();

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(async (opts) => {
  if (!opts.ctx.authenticated) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return opts.next();
});
