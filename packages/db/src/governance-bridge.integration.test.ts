import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- U009's committed reuse module is plain JS, no .d.ts.
import { withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';

import {
  fetchActiveUserCompanyRoleIds,
  fetchActorColumnFacts,
  fetchColumnPresent,
  fetchCommandRunActorContext,
  fetchGeneratedDocumentPrimaryScope,
  fetchGeneratedDocumentSecondaryLinks,
  fetchHasActiveProjectMember,
  fetchLosslessRow,
  fetchSecondaryLinkFact,
  fetchTableColumnTypes,
  fetchWorkflowProjectGroups,
  buildGenericRowEnvelope,
  type DigestClient,
} from './governance-bridge';

const integration = process.env.CI_INTEGRATION === '1';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const RUN_ID = `u020it${Date.now().toString(36)}`;
const EVIDENCE_DIR = join(REPO_ROOT, 'tmp/u020-integration-evidence');

const FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('gb-tenant-1', 'GB Tenant', 'gb-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES ('gb-company-1', 'gb-tenant-1', 'GB Company', 'gb-company-1', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('gb-project-1', 'gb-project-1', 'GB Project', 'gb-company-1', now(), now()),
  ('gb-project-other', 'gb-project-other', 'GB Other Project', 'gb-company-1', now(), now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('gb-user-1', 'gb-user-1@fixture.example.com', 'GB User', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at) VALUES
  ('gb-ucr-1', 'gb-user-1', 'gb-company-1', 'account_manager', 'active', '2020-01-01T00:00:00Z', now());

INSERT INTO project_members (id, project_id, user_id, role, status, valid_from, created_at) VALUES
  ('gb-pm-1', 'gb-project-1', 'gb-user-1', 'member', 'active', '2020-01-01T00:00:00Z', now());

INSERT INTO document_templates (id, project_id, template_key, title, body_markdown, created_at) VALUES
  ('gb-template-1', 'gb-project-1', 'proposal', 'Proposal', 'Body', now());

INSERT INTO generated_documents (id, template_id, title, body_markdown, status, created_at) VALUES
  ('gb-doc-1', 'gb-template-1', 'Doc One', 'Body One', 'draft', now());

INSERT INTO document_versions (id, generated_document_id, version, body_markdown, created_at) VALUES
  ('gb-ver-1', 'gb-doc-1', 1, 'Version One Body', now());

INSERT INTO customers (id, project_id, name, created_at, updated_at) VALUES
  ('gb-customer-1', 'gb-project-1', 'Customer One', now(), now()),
  ('gb-customer-cross', 'gb-project-other', 'Customer Cross', now(), now());

INSERT INTO commands (id, key, title, created_at) VALUES ('gb-command-1', 'gb-command', 'GB Command', now());

INSERT INTO command_runs (id, command_id, project_id, requested_by_id, status, created_at, updated_at) VALUES
  ('gb-cr-1', 'gb-command-1', 'gb-project-1', 'gb-user-1', 'succeeded', now(), now());

INSERT INTO workflows (id, command_run_id, status, created_at, updated_at) VALUES ('gb-wf-1', 'gb-cr-1', 'succeeded', now(), now());

INSERT INTO workflow_steps (id, workflow_id, step_key, status, sort_order, created_at, updated_at) VALUES ('gb-step-1', 'gb-wf-1', 'do', 'succeeded', 0, now(), now());
`;

let prisma: PrismaClient | null = null;
let cleanupFn: (() => Promise<void>) | null = null;

describe.skipIf(!integration)('governance-bridge DB-touching layer (integration, requires Docker + CI_INTEGRATION=1)', () => {
  beforeAll(async () => {
    let resolveReady: (databaseUrl: string) => void;
    const ready = new Promise<string>((r) => (resolveReady = r));
    let releaseCallback: (() => void) | null = null;
    const held = new Promise<void>((r) => (releaseCallback = r));

    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: 'U020', purpose: 'governance-bridge-integration', evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true },
      async (ctx: { databaseUrl: string }) => {
        resolveReady(ctx.databaseUrl);
        await held;
      },
    );
    cleanupFn = async () => {
      releaseCallback?.();
      await lifecycle;
    };

    const databaseUrl = await ready;
    prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    for (const statement of FIXTURE_SQL.split(';\n\n')) {
      const trimmed = statement.trim();
      if (trimmed.length === 0) continue;
      await prisma.$executeRawUnsafe(`${trimmed};`);
    }
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await cleanupFn?.();
  }, 60_000);

  it('the real baseline has neither generated_documents.created_by_id nor document_versions.created_by_id', async () => {
    const client = prisma as unknown as DigestClient;
    expect(await fetchColumnPresent(client, 'generated_documents', 'created_by_id')).toBe(false);
    expect(await fetchColumnPresent(client, 'document_versions', 'created_by_id')).toBe(false);
  });

  it('fetchTableColumnTypes returns every physical column of generated_documents', async () => {
    const client = prisma as unknown as DigestClient;
    const types = await fetchTableColumnTypes(client, 'generated_documents');
    expect(Object.keys(types).sort()).toEqual(
      ['body_markdown', 'created_at', 'customer_id', 'engagement_id', 'id', 'opportunity_id', 'poc_project_id', 'status', 'template_id', 'title'].sort(),
    );
  });

  it('fetchLosslessRow + buildGenericRowEnvelope round-trips a real generated_documents row losslessly', async () => {
    const client = prisma as unknown as DigestClient;
    const row = await fetchLosslessRow(client, 'generated_documents', 'id', 'gb-doc-1', false);
    expect(row).not.toBeNull();
    const envelope = buildGenericRowEnvelope('GeneratedDocument', row!.columnTypes, row!.values);
    expect(envelope.columns.map((c) => c.name)).toEqual([...envelope.columns.map((c) => c.name)].sort());
    const idCol = envelope.columns.find((c) => c.name === 'id');
    expect(idCol?.value).toBe('gb-doc-1');
    const createdAtCol = envelope.columns.find((c) => c.name === 'created_at');
    expect(createdAtCol?.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });

  it('fetchGeneratedDocumentPrimaryScope resolves the exact template -> project -> company -> tenant chain', async () => {
    const client = prisma as unknown as DigestClient;
    const facts = await fetchGeneratedDocumentPrimaryScope(client, 'gb-template-1');
    expect(facts).toEqual({
      templateExists: true,
      templateProjectId: 'gb-project-1',
      projectExists: true,
      projectCompanyId: 'gb-company-1',
      companyExists: true,
      companyTenantId: 'gb-tenant-1',
      tenantExists: true,
    });
  });

  it('fetchGeneratedDocumentPrimaryScope reports missing_source shape for a nonexistent template', async () => {
    const client = prisma as unknown as DigestClient;
    const facts = await fetchGeneratedDocumentPrimaryScope(client, 'no-such-template');
    expect(facts.templateExists).toBe(false);
    expect(facts.templateProjectId).toBeNull();
  });

  // A live, migrated database can never produce a `missing_scope` (project.company_id IS NULL)
  // fixture via a fresh INSERT — the U012 `projects_company_id_required_for_new_rows_check`
  // watermark CHECK forbids any new row from carrying a null company_id; only a pre-existing
  // (grandfathered, pre-watermark) row can be in that state. That branch of
  // `fetchGeneratedDocumentPrimaryScope`/`classifyGeneratedDocumentScope` is exhaustively covered
  // by the pure-function fixtures in governance-bridge.test.ts instead.

  it('fetchSecondaryLinkFact resolves an existing customer to its own projectId', async () => {
    const client = prisma as unknown as DigestClient;
    const fact = await fetchSecondaryLinkFact(client, 'customer_id', 'gb-customer-1');
    expect(fact).toEqual({ column: 'customer_id', targetModel: 'Customer', targetId: 'gb-customer-1', targetExists: true, targetProjectId: 'gb-project-1' });
  });

  it('fetchSecondaryLinkFact reports a cross-scope customer (different project) without opining on it (classification is the pure layer\'s job)', async () => {
    const client = prisma as unknown as DigestClient;
    const fact = await fetchSecondaryLinkFact(client, 'customer_id', 'gb-customer-cross');
    expect(fact.targetExists).toBe(true);
    expect(fact.targetProjectId).toBe('gb-project-other');
  });

  it('fetchSecondaryLinkFact reports missing for a nonexistent target', async () => {
    const client = prisma as unknown as DigestClient;
    const fact = await fetchSecondaryLinkFact(client, 'customer_id', 'no-such-customer');
    expect(fact.targetExists).toBe(false);
    expect(fact.targetProjectId).toBeNull();
  });

  it('fetchGeneratedDocumentSecondaryLinks only queries non-null columns', async () => {
    const client = prisma as unknown as DigestClient;
    const links = await fetchGeneratedDocumentSecondaryLinks(client, { customerId: 'gb-customer-1', pocProjectId: null, opportunityId: null, engagementId: null });
    expect(links).toHaveLength(1);
    expect(links[0]!.column).toBe('customer_id');
  });

  it('fetchActiveUserCompanyRoleIds finds the exact time-valid UserCompanyRole and nothing else', async () => {
    const client = prisma as unknown as DigestClient;
    const ids = await fetchActiveUserCompanyRoleIds(client, 'gb-user-1', 'gb-company-1', '2026-07-01T00:00:00.000000Z');
    expect(ids).toEqual(['gb-ucr-1']);
    const none = await fetchActiveUserCompanyRoleIds(client, 'gb-user-1', 'gb-company-1', '2019-01-01T00:00:00.000000Z');
    expect(none).toEqual([]);
  });

  it('fetchHasActiveProjectMember is true within the valid window and false before it', async () => {
    const client = prisma as unknown as DigestClient;
    expect(await fetchHasActiveProjectMember(client, 'gb-user-1', 'gb-project-1', '2026-07-01T00:00:00.000000Z')).toBe(true);
    expect(await fetchHasActiveProjectMember(client, 'gb-user-1', 'gb-project-1', '2019-01-01T00:00:00.000000Z')).toBe(false);
  });

  it('fetchActorColumnFacts reports columnPresent=false for generated_documents (the real baseline), independent of company/project', async () => {
    const client = prisma as unknown as DigestClient;
    const facts = await fetchActorColumnFacts(client, { columnPresent: false, rawUserId: null, companyId: 'gb-company-1', projectId: 'gb-project-1', atIso: '2026-07-01T00:00:00.000000Z' });
    expect(facts).toEqual({ columnPresent: false, rawUserId: null, matchingUserCompanyRoleIds: [], hasActiveProjectMember: false });
  });

  it('fetchActorColumnFacts resolves a real user cleanly when a hypothetical column value is supplied', async () => {
    const client = prisma as unknown as DigestClient;
    const facts = await fetchActorColumnFacts(client, { columnPresent: true, rawUserId: 'gb-user-1', companyId: 'gb-company-1', projectId: 'gb-project-1', atIso: '2026-07-01T00:00:00.000000Z' });
    expect(facts.matchingUserCompanyRoleIds).toEqual(['gb-ucr-1']);
    expect(facts.hasActiveProjectMember).toBe(true);
  });

  it('fetchCommandRunActorContext resolves the exact scope/actor chain for a real CommandRun', async () => {
    const client = prisma as unknown as DigestClient;
    const ctx = await fetchCommandRunActorContext(client, 'gb-cr-1');
    expect(ctx.commandRunExists).toBe(true);
    expect(ctx.projectId).toBe('gb-project-1');
    expect(ctx.requestedById).toBe('gb-user-1');
    expect(ctx.companyId).toBe('gb-company-1');
    expect(ctx.tenantId).toBe('gb-tenant-1');
    expect(ctx.createdAtIso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  });

  it('fetchCommandRunActorContext reports commandRunExists=false for a dangling id', async () => {
    const client = prisma as unknown as DigestClient;
    const ctx = await fetchCommandRunActorContext(client, 'no-such-command-run');
    expect(ctx.commandRunExists).toBe(false);
    expect(ctx.projectId).toBeNull();
  });

  it('fetchWorkflowProjectGroups groups the one seeded legacy Workflow under its CommandRun.projectId', async () => {
    const client = prisma as unknown as DigestClient;
    const groups = await fetchWorkflowProjectGroups(client);
    expect(groups.get('gb-project-1')).toEqual([{ workflowId: 'gb-wf-1', commandRunId: 'gb-cr-1' }]);
  });
});
