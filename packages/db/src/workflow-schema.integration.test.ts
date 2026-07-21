import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- U009's committed reuse module is plain JS, no .d.ts.
import { withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';
import { parseCanonicalArtifactContent } from './canonical-content-hash';

const integration = process.env.CI_INTEGRATION === '1';

const POLICY_HASH = '55'.repeat(32);

const FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('fx-wf-tenant-1', 'Fixture Tenant', 'fx-wf-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('fx-wf-company-1', 'fx-wf-tenant-1', 'Company One', 'fx-wf-company-1', now()),
  ('fx-wf-company-2', 'fx-wf-tenant-1', 'Company Two', 'fx-wf-company-2', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('fx-wf-project-1', 'fx-wf-project-1', 'Project One', 'fx-wf-company-1', now(), now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('fx-wf-user-requester', 'wf-requester@fixture.example.com', 'Requester', now(), now()),
  ('fx-wf-user-actor1', 'wf-actor1@fixture.example.com', 'Actor One', now(), now()),
  ('fx-wf-user-actor2', 'wf-actor2@fixture.example.com', 'Actor Two', now(), now()),
  ('fx-wf-user-cross', 'wf-cross@fixture.example.com', 'Cross Company', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, created_at) VALUES
  ('fx-wf-ucr-requester', 'fx-wf-user-requester', 'fx-wf-company-1', 'account_manager', 'active', now()),
  ('fx-wf-ucr-actor1', 'fx-wf-user-actor1', 'fx-wf-company-1', 'account_manager', 'active', now()),
  ('fx-wf-ucr-actor2', 'fx-wf-user-actor2', 'fx-wf-company-1', 'account_manager', 'active', now()),
  ('fx-wf-ucr-cross', 'fx-wf-user-cross', 'fx-wf-company-2', 'account_manager', 'active', now());
`;

const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const RUN_ID = `u019it${Date.now().toString(36)}`;
const EVIDENCE_DIR = join(tmpdir(), 'u019-integration-evidence');

let prisma: PrismaClient | null = null;
let cleanupFn: (() => Promise<void>) | null = null;
let definitionArtifactVersionId: string;
let definitionHash: string;
let definitionJson: unknown;
let approvedAt: Date;

async function pgJcsOfEnvelope(client: PrismaClient, payload: unknown): Promise<string> {
  const rows = await client.$queryRawUnsafe<{ c: string }[]>(
    `SELECT public.sangfor_rfc8785_jcs_v1(jsonb_build_object('contract','sangfor.artifact-content','payload',$1::jsonb,'version',1)) AS c`,
    JSON.stringify(payload),
  );
  return rows[0]!.c;
}

async function pgSha256(client: PrismaClient, text: string): Promise<string> {
  const rows = await client.$queryRawUnsafe<{ c: string }[]>(`SELECT public.sangfor_sha256_utf8($1) AS c`, text);
  return rows[0]!.c;
}

describe.skipIf(!integration)('workflow persistence schema (integration, requires Docker + CI_INTEGRATION=1)', () => {
  beforeAll(async () => {
    let resolveReady: (databaseUrl: string) => void;
    const ready = new Promise<string>((r) => (resolveReady = r));
    let releaseCallback: (() => void) | null = null;
    const held = new Promise<void>((r) => (releaseCallback = r));

    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: 'U019', purpose: 'workflow-schema-integration', evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true },
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

    const content = parseCanonicalArtifactContent(JSON.stringify({ steps: [{ key: 'fetch' }, { key: 'load' }] }));
    await prisma.artifact.create({
      data: {
        id: 'fx-wf-art-1',
        tenantId: 'fx-wf-tenant-1',
        companyId: 'fx-wf-company-1',
        projectId: 'fx-wf-project-1',
        artifactType: 'workflow-definition',
        classification: 'internal',
        origin: 'human',
        title: 'Integration Workflow Definition',
        createdByAssignmentId: 'fx-wf-ucr-requester',
        ownerAssignmentId: 'fx-wf-ucr-requester',
      },
    });
    const version = await prisma.artifactVersion.create({
      data: {
        id: 'fx-wf-artv-1',
        artifactId: 'fx-wf-art-1',
        version: 1,
        contentHashVersion: content.contentHashVersion,
        canonicalContentEnvelope: content.canonicalContentEnvelope,
        contentHash: content.contentHash,
        contentJson: content.contentJson as Prisma.InputJsonValue,
        status: 'review_ready',
        createdByAssignmentId: 'fx-wf-ucr-requester',
      },
    });
    definitionArtifactVersionId = version.id;
    definitionHash = version.contentHash;
    definitionJson = content.contentJson;
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await cleanupFn?.();
  }, 60_000);

  describe('JS <-> PostgreSQL content-hash parity for a workflow-definition payload', () => {
    it('the JS-built envelope/hash matches the PG-side reconstruction from the same content_json', async () => {
      const client = prisma!;
      const pgEnvelope = await pgJcsOfEnvelope(client, definitionJson);
      const pgHash = await pgSha256(client, pgEnvelope);
      expect(pgHash).toBe(definitionHash);
    });
  });

  describe('positive fixtures: draft definition, activation, pending run graph', () => {
    it('creates a revision-0 draft WorkflowDefinition linked to its exact ArtifactVersion with no activation', async () => {
      const client = prisma!;
      const def = await client.workflowDefinition.create({
        data: {
          id: 'fx-wf-def-1',
          tenantId: 'fx-wf-tenant-1',
          companyId: 'fx-wf-company-1',
          projectId: 'fx-wf-project-1',
          workflowKey: 'ingest-pipeline',
          name: 'Ingest Pipeline',
          version: 1,
          definitionArtifactVersionId,
          definitionHashVersion: 'artifact-content/rfc8785-jcs-sha256/v1',
          definitionHash,
          definitionJson: definitionJson as Prisma.InputJsonValue,
          createdByAssignmentId: 'fx-wf-ucr-requester',
        },
      });
      expect(def.revision).toBe(0);
      expect(def.status).toBe('draft');
      expect(def.activationApprovalRequestId).toBeNull();
    });

    it('activates the definition once a real ApprovalCurrentValidity row exists at the exact revision', async () => {
      const client = prisma!;
      await client.$executeRawUnsafe(
        `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, revision, legacy_unbound, updated_at)
         VALUES ('fx-wf-appr-1', 'pending', now(), 'fx-wf-tenant-1', 'fx-wf-company-1', 'fx-wf-project-1', $1, 'workflow-activate', $2, 'fx-wf-ucr-requester', 'sess', 'fx-wf-ucr-requester', 'wf-activate-gate', 'v1', $3, '{}'::jsonb, 2, 0, false, now());`,
        definitionArtifactVersionId,
        definitionHash,
        POLICY_HASH,
      );
      // A parameterized $executeRawUnsafe call is a single prepared statement — PostgreSQL
      // rejects multiple semicolon-separated commands in one prepared statement (error 42601), so
      // each status transition below is its own call (unlike the plain, param-free multi-statement
      // blocks used in run-db-contract.ts's psql -c invocations).
      await client.$executeRawUnsafe(`UPDATE approval_requests SET status = 'ready_for_human_approval' WHERE id = 'fx-wf-appr-1';`);
      await client.$executeRawUnsafe(`UPDATE approval_requests SET status = 'approved' WHERE id = 'fx-wf-appr-1';`);
      approvedAt = new Date();
      await client.$executeRawUnsafe(
        `INSERT INTO approval_current_validity (approval_request_id, request_revision, artifact_version_id, artifact_hash_snapshot, policy_hash_snapshot, required_quorum, satisfied_quorum, last_decision_sequence, state, evaluated_at, updated_at)
         VALUES ('fx-wf-appr-1', 0, $1, $2, $3, 2, 2, 2, 'valid', now(), now());`,
        definitionArtifactVersionId,
        definitionHash,
        POLICY_HASH,
      );

      const activated = await client.workflowDefinition.update({
        where: { id: 'fx-wf-def-1' },
        data: {
          status: 'active',
          revision: 1,
          activationApprovalRequestId: 'fx-wf-appr-1',
          activationApprovalRequestRevision: 0,
          activationApprovalArtifactVersionId: definitionArtifactVersionId,
          activationApprovalArtifactHash: definitionHash,
          activationApprovalPolicyHash: POLICY_HASH,
          activationApprovedAt: approvedAt,
        },
      });
      expect(activated.status).toBe('active');
      expect(activated.revision).toBe(1);
    });

    it('creates a fully snapshotted, non-executed pending canonical WorkflowRun with pending steps, copying the activation snapshot byte-for-byte', async () => {
      const client = prisma!;
      const run = await client.workflowRun.create({
        data: {
          id: 'fx-wf-run-1',
          tenantId: 'fx-wf-tenant-1',
          companyId: 'fx-wf-company-1',
          projectId: 'fx-wf-project-1',
          workflowDefinitionId: 'fx-wf-def-1',
          definitionVersion: 1,
          definitionArtifactVersionId,
          definitionArtifactHashVersion: 'artifact-content/rfc8785-jcs-sha256/v1',
          definitionArtifactHash: definitionHash,
          activationApprovalRequestId: 'fx-wf-appr-1',
          activationApprovalRequestRevision: 0,
          activationApprovalArtifactVersionId: definitionArtifactVersionId,
          activationApprovalArtifactHash: definitionHash,
          activationApprovalPolicyHash: POLICY_HASH,
          activationApprovedAt: approvedAt,
          requestedByAssignmentId: 'fx-wf-ucr-requester',
          requestedSessionId: 'sess-run-1',
          idempotencyKey: 'run-key-1',
        },
      });
      expect(run.status).toBe('pending');
      expect(run.revision).toBe(0);

      await client.workflowRunStep.createMany({
        data: [
          { id: 'fx-wf-step-1', workflowRunId: 'fx-wf-run-1', stepKey: 'fetch', sortOrder: 0 },
          { id: 'fx-wf-step-2', workflowRunId: 'fx-wf-run-1', stepKey: 'load', sortOrder: 1 },
        ],
      });
      const steps = await client.workflowRunStep.findMany({ where: { workflowRunId: 'fx-wf-run-1' }, orderBy: { sortOrder: 'asc' } });
      expect(steps.map((s) => s.status)).toEqual(['pending', 'pending']);

      await client.workflowRunEvent.create({
        data: { id: 'fx-wf-evt-1', workflowRunId: 'fx-wf-run-1', sequence: 1, eventType: 'run.created', actorAssignmentId: 'fx-wf-ucr-requester', actorSessionId: 'sess-run-1' },
      });

      const legacyWorkflowCount = await client.workflow.count();
      const legacyStepCount = await client.workflowStep.count();
      expect(legacyWorkflowCount).toBe(0);
      expect(legacyStepCount).toBe(0);
    });

    it('cascade-cancels every nonterminal step when the run itself is cancelled', async () => {
      const client = prisma!;
      await client.workflowRun.update({ where: { id: 'fx-wf-run-1' }, data: { status: 'cancelled', revision: 1 } });
      const steps = await client.workflowRunStep.findMany({ where: { workflowRunId: 'fx-wf-run-1' }, orderBy: { sortOrder: 'asc' } });
      expect(steps.every((s) => s.status === 'cancelled')).toBe(true);
      expect(steps.every((s) => s.revision === 1)).toBe(true);
    });
  });

  describe('negative fixtures', () => {
    it('rejects a definition whose definitionArtifactVersionId does not exist', async () => {
      const client = prisma!;
      await expect(
        client.workflowDefinition.create({
          data: {
            id: 'fx-wf-neg-missingartv',
            tenantId: 'fx-wf-tenant-1',
            companyId: 'fx-wf-company-1',
            projectId: 'fx-wf-project-1',
            workflowKey: 'missing-artv',
            name: 'T',
            version: 1,
            definitionArtifactVersionId: 'nonexistent',
            definitionHashVersion: 'artifact-content/rfc8785-jcs-sha256/v1',
            definitionHash: 'a'.repeat(64),
            definitionJson: {},
            createdByAssignmentId: 'fx-wf-ucr-requester',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects a cross-company createdByAssignmentId (composite FK)', async () => {
      const client = prisma!;
      await expect(
        client.workflowDefinition.create({
          data: {
            id: 'fx-wf-neg-crosscreator',
            tenantId: 'fx-wf-tenant-1',
            companyId: 'fx-wf-company-1',
            projectId: 'fx-wf-project-1',
            workflowKey: 'cross-creator',
            name: 'T',
            version: 2,
            definitionArtifactVersionId,
            definitionHashVersion: 'artifact-content/rfc8785-jcs-sha256/v1',
            definitionHash,
            definitionJson: definitionJson as Prisma.InputJsonValue,
            createdByAssignmentId: 'fx-wf-ucr-cross',
          },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it('rejects a definition identity edit after leaving draft', async () => {
      const client = prisma!;
      await expect(
        client.workflowDefinition.update({ where: { id: 'fx-wf-def-1' }, data: { workflowKey: 'renamed', revision: 2 } }),
      ).rejects.toThrow();
    });

    it('rejects a run whose definitionVersion does not match the parent WorkflowDefinition', async () => {
      const client = prisma!;
      await expect(
        client.workflowRun.create({
          data: {
            id: 'fx-wf-neg-runversion',
            tenantId: 'fx-wf-tenant-1',
            companyId: 'fx-wf-company-1',
            projectId: 'fx-wf-project-1',
            workflowDefinitionId: 'fx-wf-def-1',
            definitionVersion: 99,
            definitionArtifactVersionId,
            definitionArtifactHashVersion: 'artifact-content/rfc8785-jcs-sha256/v1',
            definitionArtifactHash: definitionHash,
            requestedByAssignmentId: 'fx-wf-ucr-requester',
            requestedSessionId: 'sess',
            idempotencyKey: 'run-key-negversion',
            status: 'legacy_imported',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects a non-legacy_imported run that drops the copied activation snapshot', async () => {
      const client = prisma!;
      await expect(
        client.workflowRun.create({
          data: {
            id: 'fx-wf-neg-dropactivation',
            tenantId: 'fx-wf-tenant-1',
            companyId: 'fx-wf-company-1',
            projectId: 'fx-wf-project-1',
            workflowDefinitionId: 'fx-wf-def-1',
            definitionVersion: 1,
            definitionArtifactVersionId,
            definitionArtifactHashVersion: 'artifact-content/rfc8785-jcs-sha256/v1',
            definitionArtifactHash: definitionHash,
            requestedByAssignmentId: 'fx-wf-ucr-requester',
            requestedSessionId: 'sess',
            idempotencyKey: 'run-key-negdropactivation',
          },
        }),
      ).rejects.toThrow();
    });

    it("rejects mutating an already-inserted run's activationApprovedAt (post-insert immutability)", async () => {
      const client = prisma!;
      await expect(
        client.workflowRun.update({ where: { id: 'fx-wf-run-1' }, data: { activationApprovedAt: new Date(Date.now() + 86_400_000) } }),
      ).rejects.toThrow();
    });

    it('rejects reopening a terminal (cancelled) run', async () => {
      const client = prisma!;
      await expect(
        client.workflowRun.update({ where: { id: 'fx-wf-run-1' }, data: { status: 'running', revision: 2 } }),
      ).rejects.toThrow();
    });

    it('rejects an illegal run status literal', async () => {
      const client = prisma!;
      await expect(
        client.$executeRawUnsafe(
          `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash, requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
           VALUES ('fx-wf-neg-badstatus', 'fx-wf-tenant-1', 'fx-wf-company-1', 'fx-wf-project-1', 'fx-wf-def-1', 1, $1, 'artifact-content/rfc8785-jcs-sha256/v1', $2, 'fx-wf-ucr-requester', 'sess', 'run-key-negbadstatus', 'not_a_real_status', 0, now(), now());`,
          definitionArtifactVersionId,
          definitionHash,
        ),
      ).rejects.toThrow();
    });

    it('rejects a duplicate scoped idempotency key', async () => {
      const client = prisma!;
      await expect(
        client.$executeRawUnsafe(
          `INSERT INTO workflow_runs (id, tenant_id, company_id, project_id, workflow_definition_id, definition_version, definition_artifact_version_id, definition_artifact_hash_version, definition_artifact_hash, requested_by_assignment_id, requested_session_id, idempotency_key, status, revision, created_at, updated_at)
           VALUES ('fx-wf-neg-dupidem', 'fx-wf-tenant-1', 'fx-wf-company-1', 'fx-wf-project-1', 'fx-wf-def-1', 1, $1, 'artifact-content/rfc8785-jcs-sha256/v1', $2, 'fx-wf-ucr-requester', 'sess', 'run-key-1', 'legacy_imported', 0, now(), now());`,
          definitionArtifactVersionId,
          definitionHash,
        ),
      ).rejects.toThrow();
    });

    it('rejects a cross-scope ArtifactVersion link on WorkflowRunArtifact', async () => {
      const client = prisma!;
      await client.project.create({
        data: { id: 'fx-wf-project-cross', slug: 'fx-wf-project-cross', name: 'Cross Project', companyId: 'fx-wf-company-2' },
      });
      await client.artifact.create({
        data: {
          id: 'fx-wf-art-cross',
          tenantId: 'fx-wf-tenant-1',
          companyId: 'fx-wf-company-2',
          projectId: 'fx-wf-project-cross',
          artifactType: 'proposal',
          classification: 'internal',
          origin: 'human',
          title: 'Cross Company Artifact',
          createdByAssignmentId: 'fx-wf-ucr-cross',
          ownerAssignmentId: 'fx-wf-ucr-cross',
        },
      });
      const content = parseCanonicalArtifactContent(JSON.stringify({ cross: true }));
      const crossVersion = await client.artifactVersion.create({
        data: {
          id: 'fx-wf-artv-cross',
          artifactId: 'fx-wf-art-cross',
          version: 1,
          contentHashVersion: content.contentHashVersion,
          canonicalContentEnvelope: content.canonicalContentEnvelope,
          contentHash: content.contentHash,
          contentJson: content.contentJson as Prisma.InputJsonValue,
          status: 'ai_draft',
          createdByAssignmentId: 'fx-wf-ucr-cross',
        },
      });
      await expect(
        client.workflowRunArtifact.create({
          data: { id: 'fx-wf-neg-runart-cross', workflowRunId: 'fx-wf-run-1', artifactVersionId: crossVersion.id, role: 'input', direction: 'input' },
        }),
      ).rejects.toThrow();
    });

    it('rejects a duplicate and a nonpositive event sequence, and denies UPDATE/DELETE on events (append-only)', async () => {
      const client = prisma!;
      await expect(
        client.workflowRunEvent.create({ data: { id: 'fx-wf-neg-dupseq', workflowRunId: 'fx-wf-run-1', sequence: 1, eventType: 'run.duplicate' } }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      await expect(
        client.workflowRunEvent.create({ data: { id: 'fx-wf-neg-zeroseq', workflowRunId: 'fx-wf-run-1', sequence: 0, eventType: 'run.zero' } }),
      ).rejects.toThrow();
      await expect(
        client.workflowRunEvent.update({ where: { id: 'fx-wf-evt-1' }, data: { eventType: 'run.changed' } }),
      ).rejects.toThrow();
      await expect(client.workflowRunEvent.delete({ where: { id: 'fx-wf-evt-1' } })).rejects.toThrow();
    });
  });
});
