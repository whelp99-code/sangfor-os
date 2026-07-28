import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  InternalPrincipalReplayError,
  claimInternalPrincipalReplay,
} from './internal-principal-replay';

const integration = process.env.CI_INTEGRATION === '1';
const SCOPE = { tenantId: 'u026-tenant', companyId: 'u026-company', projectId: 'u026-project' };

let client: PrismaClient | undefined;

describe.skipIf(!integration)('internal principal durable replay claim (U026)', () => {
  beforeAll(async () => {
    const databaseUrl = process.env.TASK_OWNED_DATABASE_URL ?? process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('U026 integration requires the U009 task-owned DATABASE_URL');
    client = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    await client.tenant.create({ data: { id: SCOPE.tenantId, name: 'U026 tenant', slug: SCOPE.tenantId, status: 'active' } });
    await client.company.create({ data: { id: SCOPE.companyId, tenantId: SCOPE.tenantId, name: 'U026 company', slug: SCOPE.companyId } });
    await client.project.create({ data: { id: SCOPE.projectId, companyId: SCOPE.companyId, name: 'U026 project', slug: SCOPE.projectId } });
  }, 180_000);

  afterAll(async () => {
    await client?.$disconnect();
  }, 60_000);

  it('atomically persists jti, nonce, and idempotency claims and rejects cross-profile replay after a fresh claimant', async () => {
    const input = {
      profile: 'SCHEDULER' as const, subjectId: 'sangfor-scheduler', ...SCOPE,
      jti: 'AAAAAAAAAAAAAAAAAAAAAA', nonce: 'BBBBBBBBBBBBBBBBBBBBBB', idempotencyKey: 'tick-1',
    };
    await expect(claimInternalPrincipalReplay(input, client!)).resolves.toMatchObject({ claimed: true });

    // A fresh caller has no process-local state. The durable U021 audit/idempotency boundary must still reject it.
    await expect(claimInternalPrincipalReplay(input, client!)).rejects.toThrow(InternalPrincipalReplayError);
    await expect(claimInternalPrincipalReplay({ ...input, profile: 'FINANCE' }, client!)).rejects.toThrow(InternalPrincipalReplayError);

    const rows = await client!.auditLog.findMany({ where: { eventType: 'internal_principal.claim' } });
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toContain('signature');
    expect(JSON.stringify(rows)).not.toContain('secretBase64Url');
  });
});
