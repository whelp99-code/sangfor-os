import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class HealthService {
  constructor(@Inject('PRISMA') private readonly prisma: any) {}

  check() {
    return { status: 'ok', service: 'cfo-api', timestamp: new Date().toISOString() };
  }

  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', database: 'connected', timestamp: new Date().toISOString() };
    } catch (e: any) {
      return { status: 'not_ready', database: 'disconnected', error: e?.message };
    }
  }
}
