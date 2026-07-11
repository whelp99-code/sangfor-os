/**
 * App Router
 * 메인 tRPC 라우터
 */

import { router } from './trpc';
import { cfoRouter } from './cfo';

export const appRouter = router({
  cfo: cfoRouter,
});

export type AppRouter = typeof appRouter;
