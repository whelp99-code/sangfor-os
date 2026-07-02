import { z } from 'zod';
import { router, financeProcedure } from '../trpc';
import { ProjectsService } from '../../services/finance';

const service = new ProjectsService();

export const projectsRouter = router({
  list: financeProcedure
    .input(z.object({ status: z.string().optional(), limit: z.number().default(100) }).optional())
    .query(async ({ input }) => service.list(input ?? { limit: 100 })),
  get: financeProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => service.get(input.id)),
});
