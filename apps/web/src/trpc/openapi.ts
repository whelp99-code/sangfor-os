import { generateOpenApiDocument } from 'trpc-to-openapi';
import { appRouter } from './index';

export const openApiDocument = generateOpenApiDocument(appRouter, {
  title: 'Sangfor OS API',
  description: 'Type-safe API for Sangfor OS',
  version: '1.0.0',
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000/api',
  tags: ['hello'],
});
