import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MODEL_SCOPE_INVENTORY } from './scope-inventory';

const integration = process.env.CI_INTEGRATION === '1';
let admin: PrismaClient;
let app: PrismaClient;

describe.skipIf(!integration)('U073 complete RLS closure on isolated Postgres', () => {
  const expectedScopedTableCount = Object.values(MODEL_SCOPE_INVENTORY).filter((entry) => entry.category !== 'GLOBAL_SHARED').length;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL || !process.env.SANGFOR_APP_DATABASE_URL) {
      throw new Error('U073 integration test requires injected scratch DATABASE_URL and SANGFOR_APP_DATABASE_URL');
    }
    admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    app = new PrismaClient({ datasources: { db: { url: process.env.SANGFOR_APP_DATABASE_URL } } });

    for (const suffix of ['a', 'b']) {
      await admin.tenant.create({ data: { id: `u073-tenant-${suffix}`, slug: `u073-tenant-${suffix}`, name: `U073 Tenant ${suffix}`, status: 'active' } });
      await admin.company.create({ data: { id: `u073-company-${suffix}`, tenantId: `u073-tenant-${suffix}`, slug: `u073-company-${suffix}`, name: `U073 Company ${suffix}` } });
      await admin.schedulerJob.create({ data: {
        id: `u073-job-${suffix}`, companyId: `u073-company-${suffix}`, scopeKey: `company:u073-company-${suffix}`,
        jobKey: 'rls-proof', handlerKey: 'rls.proof', scheduleKind: 'manual', scheduleExpression: 'manual', createdBy: 'u073-test',
      } });
      await admin.schedulerRun.create({ data: {
        id: `u073-run-${suffix}`, jobId: `u073-job-${suffix}`, scheduledFor: new Date(`2026-07-2${suffix === 'a' ? '6' : '7'}T00:00:00.000Z`), idempotencyKey: `u073-run-${suffix}`,
      } });
      await admin.schedulerRunAttempt.create({ data: {
        id: `u073-attempt-${suffix}`, runId: `u073-run-${suffix}`, attemptNumber: 1, workerId: `worker-${suffix}`, status: 'RUNNING',
      } });
    }
  });

  afterAll(async () => {
    await app?.$disconnect();
    await admin?.$disconnect();
  });

  it('enables and forces RLS with one canonical policy on every scoped table', async () => {
    const state = await admin.$queryRawUnsafe<Array<{ protected_count: bigint; policy_count: bigint }>>(`
      SELECT
        (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity) AS protected_count,
        (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'sangfor_scope_%') AS policy_count
    `);
    expect(Number(state[0].protected_count)).toBe(expectedScopedTableCount);
    expect(Number(state[0].policy_count)).toBe(expectedScopedTableCount);

    const schedulerPolicies = await admin.$queryRawUnsafe<Array<{ tablename: string; qual: string; with_check: string }>>(
      `SELECT tablename, qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('scheduler_jobs', 'scheduler_runs', 'scheduler_run_attempts') ORDER BY tablename`,
    );
    expect(schedulerPolicies).toHaveLength(3);
    expect(schedulerPolicies.find((policy) => policy.tablename === 'scheduler_jobs')?.qual).toContain('app.company_id');
    expect(schedulerPolicies.find((policy) => policy.tablename === 'scheduler_runs')?.qual).toContain('scheduler_jobs');
    expect(schedulerPolicies.find((policy) => policy.tablename === 'scheduler_run_attempts')?.qual).toContain('scheduler_runs');
    expect(schedulerPolicies.every((policy) => policy.qual === policy.with_check)).toBe(true);
  });

  it('filters parent and nested CHILD_VIA_FK rows and rejects a cross-scope child write', async () => {
    await app.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SET LOCAL ROLE sangfor_app');
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', 'u073-tenant-a', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.company_id', 'u073-company-a', true)`);
      await tx.$executeRawUnsafe(`SELECT set_config('app.project_id', 'u073-project-a', true)`);

      expect(await tx.schedulerJob.count()).toBe(1);
      expect(await tx.schedulerRun.count()).toBe(1);
      expect(await tx.schedulerRunAttempt.count()).toBe(1);
      await expect(tx.schedulerRunAttempt.create({ data: {
        id: 'u073-cross-scope-attempt', runId: 'u073-run-b', attemptNumber: 2, workerId: 'worker-a', status: 'RUNNING',
      } })).rejects.toThrow();
    });
  });
});
