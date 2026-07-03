import { publicProcedure } from '@/app/api/_lib/trpc-server';
import { z } from 'zod';

export const helloRouter = {
  greet: publicProcedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => {
      return { message: `Hello, ${input.name}!` };
    }),
};
