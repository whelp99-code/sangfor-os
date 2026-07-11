/**
 * App Router
 * 메인 tRPC 라우터
 */

import { router } from './trpc';

export const appRouter = router({});

export type AppRouter = typeof appRouter;
