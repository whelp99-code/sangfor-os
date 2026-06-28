import { router, publicProcedure } from '../trpc';
import { HealthService } from '../../services/finance';

const service = new HealthService();

export const healthRouter = router({
  check: publicProcedure
    .query(async () => service.check()),
  ready: publicProcedure
    .query(async () => service.ready()),
});
