import { prisma } from '@sangfor/db';

export class HealthService {
  check() {
    return { status: 'ok', service: 'cfo-api', timestamp: new Date().toISOString() };
  }

  async ready() {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'connected', timestamp: new Date().toISOString() };
    } catch (e: any) {
      return { status: 'not_ready', database: 'disconnected', error: e?.message };
    }
  }
}
