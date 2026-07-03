import { publicProcedure } from '@/app/api/_lib/trpc-server';
import { z } from 'zod';

export const helloRouter = {
  greet: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/hello.greet', tags: ['hello'] } })
    .input(z.object({ name: z.string() }))
    .output(z.object({ message: z.string() }))
    .query(({ input }) => ({ message: `Hello, ${input.name}!` })),
};
