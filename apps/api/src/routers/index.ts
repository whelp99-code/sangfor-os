/**
 * App Router
 * 메인 tRPC 라우터
 */

import { router } from './trpc';
import { mailRouter } from './mail.router';
import { workflowRouter } from './workflow.router';
import { sangforRouter } from './sangfor.router';
import { codingRouter } from './coding.router';
import { businessRouter } from './business.router';
import { dashboardRouter } from './dashboard.router';
import { searchRouter } from './search.router';

export const appRouter = router({
  mail: mailRouter,
  workflow: workflowRouter,
  sangfor: sangforRouter,
  coding: codingRouter,
  business: businessRouter,
  dashboard: dashboardRouter,
  search: searchRouter,
});

export type AppRouter = typeof appRouter;
