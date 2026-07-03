import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from '@/trpc';
import { createContext } from '@/app/api/_lib/trpc-server';
import { NextRequest } from 'next/server';

const handler = (req: NextRequest) => {
  return fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createContext({ req }),
    onError({ error }) {
      console.error('tRPC error:', error);
    },
  });
};

export { handler as GET, handler as POST };
