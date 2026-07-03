import { t } from '@/app/api/_lib/trpc-server';
import { helloRouter } from './hello';

export const appRouter = t.router({
  hello: t.router(helloRouter),
  // remaining routers will be added in later tasks
});

export type AppRouter = typeof appRouter;
