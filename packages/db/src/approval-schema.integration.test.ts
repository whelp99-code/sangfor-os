import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- U009's committed reuse module is plain JS, no .d.ts.
import { withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';
import { parseCanonicalArtifactContent } from './canonical-content-hash';

const integration = process.env.CI_INTEGRATION === '1';

const POLICY_HASH = '33'.repeat(32);

const FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('fx-appr-tenant-1', 'Fixture Tenant', 'fx-appr-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('fx-appr-company-1', 'fx-appr-tenant-1', 'Company One', 'fx-appr-company-1', now()),
  ('fx-appr-company-2', 'fx-appr-tenant-1', 'Company Two', 'fx-appr-company-2', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('fx-appr-project-1', 'fx-appr-project-1', 'Project One', 'fx-appr-company-1', now(), now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('fx-appr-user-requester', 'appr-requester@fixture.example.com', 'Requester', now(), now()),
  ('fx-appr-user-owner', 'appr-owner@fixture.example.com', 'Owner', now(), now()),
  ('fx-appr-user-owner2', 'appr-owner2@fixture.example.com', 'Owner Two', now(), now()),
  ('fx-appr-user-actor1', 'appr-actor1@fixture.example.com', 'Actor One', now(), now()),
  ('fx-appr-user-cross', 'appr-cross@fixture.example.com', 'Cross Company', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, created_at) VALUES
  ('fx-appr-ucr-requester', 'fx-appr-user-requester', 'fx-appr-company-1', 'account_manager', 'active', now()),
  ('fx-appr-ucr-owner', 'fx-appr-user-owner', 'fx-appr-company-1', 'account_manager', 'active', now()),
  ('fx-appr-ucr-owner2', 'fx-appr-user-owner2', 'fx-appr-company-1', 'account_manager', 'active', now()),
  ('fx-appr-ucr-actor1', 'fx-appr-user-actor1', 'fx-appr-company-1', 'account_manager', 'active', now()),
  ('fx-appr-ucr-cross', 'fx-appr-user-cross', 'fx-appr-company-2', 'account_manager', 'active', now());
`;

const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const RUN_ID = `u018it${Date.now().toString(36)}`;
const EVIDENCE_DIR = join(tmpdir(), 'u018-integration-evidence');

let prisma: PrismaClient | null = null;
let cleanupFn: (() => Promise<void>) | null = null;
let artifactVersionId: string;
let artifactContentHash: string;

async function pgValidationHash(client: PrismaClient, value: unknown): Promise<string> {
  const rows = await client.$queryRawUnsafe<{ c: string }[]>(
    `SELECT public.sangfor_validation_snapshot_sha256($1::jsonb) AS c`,
    JSON.stringify(value),
  );
  return rows[0]!.c;
}

describe.skipIf(!integration)('version-bound approval schema (integration, requires Docker + CI_INTEGRATION=1)', () => {
  beforeAll(async () => {
    let resolveReady: (databaseUrl: string) => void;
    const ready = new Promise<string>((r) => (resolveReady = r));
    let releaseCallback: (() => void) | null = null;
    const held = new Promise<void>((r) => (releaseCallback = r));

    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: 'U018', purpose: 'approval-schema-integration', evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true },
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

    const content = parseCanonicalArtifactContent(JSON.stringify({ title: 'integration release', body: 'v1' }));
    await prisma.artifact.create({
      data: {
        id: 'fx-appr-art-1',
        tenantId: 'fx-appr-tenant-1',
        companyId: 'fx-appr-company-1',
        projectId: 'fx-appr-project-1',
        artifactType: 'proposal',
        classification: 'internal',
        origin: 'human',
        title: 'Integration Artifact',
        createdByAssignmentId: 'fx-appr-ucr-requester',
        ownerAssignmentId: 'fx-appr-ucr-owner',
      },
    });
    const version = await prisma.artifactVersion.create({
      data: {
        id: 'fx-appr-artv-1',
        artifactId: 'fx-appr-art-1',
        version: 1,
        contentHashVersion: content.contentHashVersion,
        canonicalContentEnvelope: content.canonicalContentEnvelope,
        contentHash: content.contentHash,
        contentJson: content.contentJson as Prisma.InputJsonValue,
        status: 'review_ready',
        createdByAssignmentId: 'fx-appr-ucr-requester',
      },
    });
    artifactVersionId = version.id;
    artifactContentHash = version.contentHash;
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    await cleanupFn?.();
  }, 60_000);

  describe('PG-authoritative validation-snapshot digest — no JS hash authoritative', () => {
    const vectors: Array<{ name: string; a: unknown; b: unknown }> = [
      { name: 'reordered-keys', a: { alpha: 1, beta: 2, gamma: 3 }, b: { gamma: 3, alpha: 1, beta: 2 } },
      { name: 'nested-arrays', a: { outer: { list: [1, 2, { inner: true }] } }, b: { outer: { list: [1, 2, { inner: true }] } } },
      { name: 'unicode', a: { text: '승인 검토 완료 — é, ñ, 漢字' }, b: { text: '승인 검토 완료 — é, ñ, 漢字' } },
      { name: 'numeric', a: { score: 12.5, count: 0, big: 1e30 }, b: { big: 1e30, count: 0, score: 12.5 } },
    ];

    for (const vector of vectors) {
      it(`produces a byte-identical lowercase-hex digest for "${vector.name}" regardless of key order`, async () => {
        const client = prisma!;
        const hashA = await pgValidationHash(client, vector.a);
        const hashB = await pgValidationHash(client, vector.b);
        expect(hashA).toMatch(/^[0-9a-f]{64}$/);
        expect(hashA).toBe(hashB);
      });
    }
  });

  describe('positive fixture: explicit false, omit hash, revision-0/ownershipRevision-0 pending request, CAS owner reassignment, two immutable decisions, non-valid projection', () => {
    it('creates the canonical request and the DB fills the validation snapshot hash, matching a direct function call', async () => {
      const client = prisma!;
      const validationSnapshot = { policy: 'release-gate', inputs: { score: 9, tags: ['a', 'b'] } };
      const expectedHash = await pgValidationHash(client, validationSnapshot);

      const created = await client.$queryRawUnsafe<{ id: string; validation_snapshot_hash: string; revision: number; ownership_revision: number; status: string }[]>(
        `INSERT INTO approval_requests (
           id, status, reason, created_at, tenant_id, company_id, project_id, artifact_version_id, action,
           artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id,
           ownership_revision, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum,
           revision, legacy_unbound, updated_at
         ) VALUES (
           'fx-appr-req-1', 'pending', 'integration release gate', now(), 'fx-appr-tenant-1', 'fx-appr-company-1', 'fx-appr-project-1', $1, 'release',
           $2, 'fx-appr-ucr-requester', 'sess-req-1', 'fx-appr-ucr-owner',
           0, 'release-gate', 'v1', $3, $4::jsonb, 2,
           0, false, now()
         ) RETURNING id, validation_snapshot_hash, revision, ownership_revision, status`,
        artifactVersionId,
        artifactContentHash,
        POLICY_HASH,
        JSON.stringify(validationSnapshot),
      );

      expect(created[0]!.validation_snapshot_hash).toBe(expectedHash);
      expect(created[0]!.revision).toBe(0);
      expect(created[0]!.ownership_revision).toBe(0);
      expect(created[0]!.status).toBe('pending');
    });

    it('reads the row back through the Prisma model with the same hash', async () => {
      const client = prisma!;
      const row = await client.approvalRequest.findUniqueOrThrow({ where: { id: 'fx-appr-req-1' } });
      expect(row.legacyUnbound).toBe(false);
      expect(row.validationSnapshotHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.artifactHashSnapshot).toBe(artifactContentHash);
    });

    it('CAS-reassigns only the owner (ownershipRevision 0->1), leaving requester/revision/status unchanged', async () => {
      const client = prisma!;
      const updated = await client.approvalRequest.update({
        where: { id: 'fx-appr-req-1' },
        data: { ownerAssignmentId: 'fx-appr-ucr-owner2', ownershipRevision: 1 },
      });
      expect(updated.ownerAssignmentId).toBe('fx-appr-ucr-owner2');
      expect(updated.ownershipRevision).toBe(1);
      expect(updated.requestedByAssignmentId).toBe('fx-appr-ucr-requester');
      expect(updated.revision).toBe(0);
      expect(updated.status).toBe('pending');
    });

    it('adds two immutable ApprovalDecision rows with the exact resulting request revision', async () => {
      const client = prisma!;
      const d1 = await client.approvalDecision.create({
        data: {
          id: 'fx-appr-dec-1',
          approvalRequestId: 'fx-appr-req-1',
          sequence: 1,
          requestRevision: 0,
          artifactVersionId,
          artifactHashSnapshot: artifactContentHash,
          decision: 'approve',
          actorAssignmentId: 'fx-appr-ucr-actor1',
          actorSessionId: 'sess-actor-1',
          actorRoleSnapshot: 'account_manager',
          policyHashSnapshot: POLICY_HASH,
        },
      });
      const d2 = await client.approvalDecision.create({
        data: {
          id: 'fx-appr-dec-2',
          approvalRequestId: 'fx-appr-req-1',
          sequence: 2,
          requestRevision: 0,
          artifactVersionId,
          artifactHashSnapshot: artifactContentHash,
          decision: 'approve',
          actorAssignmentId: 'fx-appr-ucr-owner',
          actorSessionId: 'sess-actor-2',
          actorRoleSnapshot: 'account_manager',
          policyHashSnapshot: POLICY_HASH,
        },
      });
      expect(d1.sequence).toBe(1);
      expect(d2.sequence).toBe(2);
      expect(d1.requestRevision).toBe(0);
      expect(d2.requestRevision).toBe(0);
    });

    it('creates a non-valid ApprovalCurrentValidity projection', async () => {
      const client = prisma!;
      const validity = await client.approvalCurrentValidity.create({
        data: {
          approvalRequestId: 'fx-appr-req-1',
          requestRevision: 0,
          artifactVersionId,
          artifactHashSnapshot: artifactContentHash,
          policyHashSnapshot: POLICY_HASH,
          requiredQuorum: 2,
          satisfiedQuorum: 2,
          lastDecisionSequence: 2,
          state: 'pending',
        },
      });
      expect(validity.state).toBe('pending');
      const anyValid = await client.approvalCurrentValidity.count({ where: { state: 'valid' } });
      expect(anyValid).toBe(0);
    });
  });

  describe('negative fixtures', () => {
    it('rejects a canonical shape without explicit legacyUnbound=false (defaults true; canonical fields present trips the true-branch guard)', async () => {
      const client = prisma!;
      await expect(
        client.$executeRawUnsafe(
          `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, updated_at)
           VALUES ('fx-appr-neg-noflag', 'pending', now(), 'fx-appr-tenant-1', 'fx-appr-company-1', 'fx-appr-project-1', $1, 'release', $2, 'fx-appr-ucr-requester', 'sess', 'fx-appr-ucr-owner', 'release-gate', 'v1', $3, '{}'::jsonb, 2, now());`,
          artifactVersionId,
          artifactContentHash,
          POLICY_HASH,
        ),
      ).rejects.toThrow();
    });

    it('rejects a cross-company requestedByAssignment (composite FK)', async () => {
      const client = prisma!;
      await expect(
        client.$executeRawUnsafe(
          `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, legacy_unbound, updated_at)
           VALUES ('fx-appr-neg-cross', 'pending', now(), 'fx-appr-tenant-1', 'fx-appr-company-1', 'fx-appr-project-1', $1, 'release', $2, 'fx-appr-ucr-cross', 'sess', 'fx-appr-ucr-owner', 'release-gate', 'v1', $3, '{}'::jsonb, 2, false, now());`,
          artifactVersionId,
          artifactContentHash,
          POLICY_HASH,
        ),
      ).rejects.toThrow();
    });

    it('rejects mutating the immutable requestedByAssignmentId', async () => {
      const client = prisma!;
      await expect(
        client.approvalRequest.update({ where: { id: 'fx-appr-req-1' }, data: { requestedByAssignmentId: 'fx-appr-ucr-owner' } }),
      ).rejects.toThrow();
    });

    it('rejects an owner change without exactly ownershipRevision+1', async () => {
      const client = prisma!;
      await expect(
        client.approvalRequest.update({ where: { id: 'fx-appr-req-1' }, data: { ownerAssignmentId: 'fx-appr-ucr-requester', ownershipRevision: 1 } }),
      ).rejects.toThrow();
    });

    it('rejects an UPDATE that changes validationSnapshot or validationSnapshotHash', async () => {
      const client = prisma!;
      await expect(
        client.approvalRequest.update({ where: { id: 'fx-appr-req-1' }, data: { validationSnapshot: { changed: true } } }),
      ).rejects.toThrow();
    });

    it('denies UPDATE and DELETE on approval_decisions (append-only)', async () => {
      const client = prisma!;
      await expect(client.approvalDecision.update({ where: { id: 'fx-appr-dec-1' }, data: { decision: 'reject' } })).rejects.toThrow();
      await expect(client.approvalDecision.delete({ where: { id: 'fx-appr-dec-1' } })).rejects.toThrow();
    });

    it('rejects a duplicate decision sequence and a duplicate actor for the same request', async () => {
      const client = prisma!;
      await expect(
        client.approvalDecision.create({
          data: {
            id: 'fx-appr-dec-dupseq',
            approvalRequestId: 'fx-appr-req-1',
            sequence: 1,
            requestRevision: 0,
            artifactVersionId,
            artifactHashSnapshot: artifactContentHash,
            decision: 'reject',
            actorAssignmentId: 'fx-appr-ucr-owner2',
            actorSessionId: 'sess',
            actorRoleSnapshot: 'account_manager',
            policyHashSnapshot: POLICY_HASH,
          },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);

      await expect(
        client.approvalDecision.create({
          data: {
            id: 'fx-appr-dec-dupactor',
            approvalRequestId: 'fx-appr-req-1',
            sequence: 3,
            requestRevision: 0,
            artifactVersionId,
            artifactHashSnapshot: artifactContentHash,
            decision: 'reject',
            actorAssignmentId: 'fx-appr-ucr-actor1',
            actorSessionId: 'sess',
            actorRoleSnapshot: 'account_manager',
            policyHashSnapshot: POLICY_HASH,
          },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it('rejects a decision recorded against a legacyUnbound=true request (legacy rows confer zero authority)', async () => {
      const client = prisma!;
      await client.$executeRawUnsafe(
        `INSERT INTO approval_requests (id, status, created_at, legacy_unbound, updated_at) VALUES ('fx-appr-legacy-1', 'approved', now(), true, now());`,
      );
      await expect(
        client.approvalDecision.create({
          data: {
            id: 'fx-appr-dec-against-legacy',
            approvalRequestId: 'fx-appr-legacy-1',
            sequence: 1,
            requestRevision: 0,
            artifactVersionId,
            artifactHashSnapshot: artifactContentHash,
            decision: 'approve',
            actorAssignmentId: 'fx-appr-ucr-actor1',
            actorSessionId: 'sess',
            actorRoleSnapshot: 'account_manager',
            policyHashSnapshot: POLICY_HASH,
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects a duplicate OPEN request for the same (artifactVersionId, action, policyHash)', async () => {
      const client = prisma!;
      await expect(
        client.$executeRawUnsafe(
          `INSERT INTO approval_requests (id, status, created_at, tenant_id, company_id, project_id, artifact_version_id, action, artifact_hash_snapshot, requested_by_assignment_id, requested_session_id, owner_assignment_id, policy_key, policy_version, policy_hash, validation_snapshot, required_quorum, legacy_unbound, updated_at)
           VALUES ('fx-appr-neg-dupopen', 'pending', now(), 'fx-appr-tenant-1', 'fx-appr-company-1', 'fx-appr-project-1', $1, 'release', $2, 'fx-appr-ucr-requester', 'sess', 'fx-appr-ucr-owner', 'release-gate', 'v1', $3, '{}'::jsonb, 1, false, now());`,
          artifactVersionId,
          artifactContentHash,
          POLICY_HASH,
        ),
      ).rejects.toThrow();
    });
  });

  describe('the boundary proof: jsonb collapses duplicate keys the same way JSON.parse does', () => {
    it('a duplicate-key literal and a single-key literal produce an indistinguishable jsonb value', async () => {
      const client = prisma!;
      const collapsed = await client.$queryRawUnsafe<{ v: unknown }[]>(`SELECT '{"a":1,"a":2}'::jsonb AS v`);
      const neverHadADuplicate = await client.$queryRawUnsafe<{ v: unknown }[]>(`SELECT '{"a":2}'::jsonb AS v`);
      expect(collapsed[0]!.v).toEqual(neverHadADuplicate[0]!.v);
    });
  });
});
