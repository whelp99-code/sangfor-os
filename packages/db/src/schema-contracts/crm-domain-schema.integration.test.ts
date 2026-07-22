import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integration = process.env.CI_INTEGRATION === '1';
let prisma: PrismaClient;

const FIXTURE_SQL = `
INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('u032-tenant', 'U032 Tenant', 'u032-tenant', 'active', now());
INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('u032-company-a', 'u032-tenant', 'Company A', 'u032-company-a', now()),
  ('u032-company-b', 'u032-tenant', 'Company B', 'u032-company-b', now());
INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('u032-project-a', 'u032-project-a', 'Project A', 'u032-company-a', now(), now());
INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES
  ('u032-user-a', 'u032-a@example.test', 'User A', 'active', now(), now()),
  ('u032-user-b', 'u032-b@example.test', 'User B', 'active', now(), now());
INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at) VALUES
  ('u032-owner-a', 'u032-user-a', 'u032-company-a', 'account_manager', 'active', now() - interval '1 day', now()),
  ('u032-owner-a2', 'u032-user-b', 'u032-company-a', 'account_manager', 'active', now() - interval '1 day', now()),
  ('u032-owner-b', 'u032-user-b', 'u032-company-b', 'account_manager', 'active', now() - interval '1 day', now()),
  ('u032-owner-inactive', 'u032-user-b', 'u032-company-a', 'support_engineer', 'legacy_pending', now() - interval '1 day', now()),
  ('u032-owner-expired', 'u032-user-b', 'u032-company-a', 'finance_manager', 'active', now() - interval '1 day', now()),
  ('u032-owner-revoked', 'u032-user-b', 'u032-company-a', 'sales_manager', 'active', now() - interval '1 day', now());
UPDATE user_company_roles SET expires_at = now() - interval '1 second' WHERE id = 'u032-owner-expired';
UPDATE user_company_roles SET status = 'revoked', revoked_at = now() - interval '1 second' WHERE id = 'u032-owner-revoked';
`;

describe.skipIf(!integration)('U032 CRM owner guards (isolated scratch only)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('U032 verifier must inject DATABASE_URL');
    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    for (const statement of FIXTURE_SQL.split(';\n')) {
      const sql = statement.trim();
      if (sql) await prisma.$executeRawUnsafe(`${sql};`);
    }
  }, 30_000);

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('accepts same-company active assignments and preserves legacy attribution', async () => {
    const opportunity = await prisma.opportunity.create({
      data: { id: 'u032-opportunity', projectId: 'u032-project-a', title: 'Canonical owner', ownerId: 'u032-user-a', ownerAssignmentId: 'u032-owner-a' },
    });
    const task = await prisma.workTask.create({
      data: { id: 'u032-task', projectId: 'u032-project-a', title: 'Canonical owner task', assigneeName: 'Historical assignee', source: 'legacy-import', ownerAssignmentId: 'u032-owner-a' },
    });
    expect(opportunity.ownershipRevision).toBe(0);
    expect(task.ownershipRevision).toBe(0);
    expect(opportunity.ownerId).toBe('u032-user-a');
    expect(task.assigneeName).toBe('Historical assignee');
  });

  it.each(['u032-owner-b', 'u032-owner-inactive', 'u032-owner-expired', 'u032-owner-revoked', 'u032-missing-owner'])('rejects invalid assignment %s', async (ownerAssignmentId) => {
    await expect(prisma.opportunity.create({
      data: { id: `u032-invalid-op-${ownerAssignmentId}`, projectId: 'u032-project-a', title: 'Invalid owner', ownerAssignmentId },
    })).rejects.toThrow();
    await expect(prisma.workTask.create({
      data: { id: `u032-invalid-task-${ownerAssignmentId}`, projectId: 'u032-project-a', title: 'Invalid owner', ownerAssignmentId },
    })).rejects.toThrow();
  });

  it('requires CAS predicates, increments exactly once, and makes replay stale', async () => {
    const stale = await prisma.opportunity.updateMany({
      where: { id: 'u032-opportunity', ownerAssignmentId: 'u032-owner-a', ownershipRevision: 9 },
      data: { ownerAssignmentId: 'u032-owner-a2', ownershipRevision: { increment: 1 } },
    });
    expect(stale.count).toBe(0);
    const changed = await prisma.opportunity.updateMany({
      where: { id: 'u032-opportunity', ownerAssignmentId: 'u032-owner-a', ownershipRevision: 0 },
      data: { ownerAssignmentId: 'u032-owner-a2', ownershipRevision: { increment: 1 } },
    });
    expect(changed.count).toBe(1);
    const replay = await prisma.opportunity.updateMany({
      where: { id: 'u032-opportunity', ownerAssignmentId: 'u032-owner-a', ownershipRevision: 0 },
      data: { ownerAssignmentId: 'u032-owner-a2', ownershipRevision: { increment: 1 } },
    });
    expect(replay.count).toBe(0);
    expect((await prisma.opportunity.findUniqueOrThrow({ where: { id: 'u032-opportunity' } })).ownershipRevision).toBe(1);
  });

  it('rejects an owner update that rewrites immutable legacy attribution or source history', async () => {
    await expect(prisma.opportunity.update({
      where: { id: 'u032-opportunity' },
      data: { ownerAssignmentId: 'u032-owner-a', ownershipRevision: { increment: 1 }, ownerId: 'u032-user-b' },
    })).rejects.toThrow();
    await expect(prisma.workTask.update({
      where: { id: 'u032-task' },
      data: { ownerAssignmentId: 'u032-owner-a2', ownershipRevision: { increment: 1 }, assigneeName: 'Rewritten', source: 'rewritten' },
    })).rejects.toThrow();
    expect(await prisma.taskStatusEvent.count({ where: { workTaskId: 'u032-task' } })).toBe(0);
  });
});
