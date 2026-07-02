import { z } from 'zod';
import { router, financeProcedure } from '../trpc';
import { DashboardService } from '../../services/finance';

const service = new DashboardService();

export const dashboardRouter = router({
  kpi: financeProcedure
    .input(z.object({ year: z.number().optional(), month: z.number().optional() }).optional())
    .query(async ({ input }) => {
      const now = new Date();
      return service.getKpi(input?.year ?? now.getFullYear(), input?.month ?? now.getMonth() + 1);
    }),
  cashflowForecast: financeProcedure
    .input(z.object({ days: z.number().default(90) }).optional())
    .query(async ({ input }) => service.getCashflowForecast(input?.days)),
  monthlyTrend: financeProcedure
    .input(z.object({ months: z.number().default(6) }).optional())
    .query(async ({ input }) => service.getMonthlyTrend(input?.months)),
});
