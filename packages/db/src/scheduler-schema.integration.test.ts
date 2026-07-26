import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integration = process.env.CI_INTEGRATION === '1';
let prisma: PrismaClient;

describe.skipIf(!integration)('U068 durable scheduler migration', () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error('U068 integration test requires an injected scratch DATABASE_URL');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('installs tables, restrictive foreign keys, and durable uniqueness contracts', async () => {
    const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('scheduler_jobs', 'scheduler_runs', 'scheduler_run_attempts') ORDER BY table_name`,
    );
    expect(tables.map((row) => row.table_name)).toEqual(['scheduler_jobs', 'scheduler_run_attempts', 'scheduler_runs']);

    const foreignKeys = await prisma.$queryRawUnsafe<Array<{ conname: string; confdeltype: string }>>(
      `SELECT conname, confdeltype FROM pg_constraint WHERE conname IN ('scheduler_runs_job_id_fkey', 'scheduler_run_attempts_run_id_fkey') ORDER BY conname`,
    );
    expect(foreignKeys).toHaveLength(2);
    expect(foreignKeys.every((foreignKey) => foreignKey.confdeltype === 'r')).toBe(true);

    const uniqueIndexes = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN ('scheduler_jobs_company_id_scope_key_job_key_key', 'scheduler_runs_idempotency_key_key', 'scheduler_runs_job_id_scheduled_for_key', 'scheduler_run_attempts_run_id_attempt_number_key') ORDER BY indexname`,
    );
    expect(uniqueIndexes).toHaveLength(4);
  });

  it('persists jobs, runs, and attempts while rejecting duplicate durable keys', async () => {
    await prisma.tenant.create({ data: { id: 'u068-tenant', slug: 'u068-tenant', name: 'U068 Tenant', status: 'active' } });
    await prisma.company.create({ data: { id: 'u068-company', tenantId: 'u068-tenant', slug: 'u068-company', name: 'U068 Company' } });

    const job = await prisma.schedulerJob.create({
      data: {
        id: 'u068-job', companyId: 'u068-company', scopeKey: 'company:u068-company', jobKey: 'daily-sync',
        handlerKey: 'mail.sync', scheduleKind: 'cron', scheduleExpression: '0 2 * * *', createdBy: 'u068-test',
      },
    });
    const scheduledFor = new Date('2026-07-26T02:00:00.000Z');
    const run = await prisma.schedulerRun.create({
      data: { id: 'u068-run', jobId: job.id, scheduledFor, idempotencyKey: 'u068:daily-sync:2026-07-26' },
    });
    await prisma.schedulerRunAttempt.create({
      data: { id: 'u068-attempt', runId: run.id, attemptNumber: 1, workerId: 'u068-worker', status: 'RUNNING' },
    });

    await expect(prisma.schedulerRun.create({
      data: { id: 'u068-run-duplicate', jobId: job.id, scheduledFor: new Date('2026-07-27T02:00:00.000Z'), idempotencyKey: run.idempotencyKey },
    })).rejects.toThrow();
    await expect(prisma.schedulerRunAttempt.create({
      data: { id: 'u068-attempt-duplicate', runId: run.id, attemptNumber: 1, workerId: 'u068-worker-2', status: 'FAILED' },
    })).rejects.toThrow();
    await expect(prisma.schedulerJob.delete({ where: { id: job.id } })).rejects.toThrow();
  });
});
