import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- U009's committed reuse module is plain JS, no .d.ts.
import { withIsolatedPostgres } from '../../../scripts/lib/isolated-postgres.mjs';
import { canonicalizeRfc8785, parseCanonicalArtifactContent } from './canonical-content-hash';

const integration = process.env.CI_INTEGRATION === '1';

const FIXTURE_SQL = `INSERT INTO tenants (id, name, slug, status, created_at) VALUES
  ('fx-art-tenant-1', 'Fixture Tenant', 'fx-art-tenant-1', 'active', now());

INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES
  ('fx-art-company-1', 'fx-art-tenant-1', 'Company One', 'fx-art-company-1', now()),
  ('fx-art-company-2', 'fx-art-tenant-1', 'Company Two', 'fx-art-company-2', now());

INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES
  ('fx-art-project-1', 'fx-art-project-1', 'Project One', 'fx-art-company-1', now(), now());

INSERT INTO users (id, email, name, created_at, updated_at) VALUES
  ('fx-art-user-1', 'art-u1@fixture.example.com', 'User One', now(), now()),
  ('fx-art-user-2', 'art-u2@fixture.example.com', 'User Two', now(), now()),
  ('fx-art-user-3', 'art-u3@fixture.example.com', 'User Three', now(), now()),
  ('fx-art-user-cross', 'art-cross@fixture.example.com', 'Cross Company User', now(), now());

INSERT INTO user_company_roles (id, user_id, company_id, role, status, created_at) VALUES
  ('fx-art-ucr-creator', 'fx-art-user-1', 'fx-art-company-1', 'account_manager', 'active', now()),
  ('fx-art-ucr-owner', 'fx-art-user-2', 'fx-art-company-1', 'account_manager', 'active', now()),
  ('fx-art-ucr-owner2', 'fx-art-user-3', 'fx-art-company-1', 'account_manager', 'active', now()),
  ('fx-art-ucr-cross', 'fx-art-user-cross', 'fx-art-company-2', 'account_manager', 'active', now());
`;

const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
const RUN_ID = `u017it${Date.now().toString(36)}`;
const EVIDENCE_DIR = join(tmpdir(), 'u017-integration-evidence');

let prisma: PrismaClient | null = null;
let cleanupFn: (() => Promise<void>) | null = null;

async function pgJcs(client: PrismaClient, value: unknown): Promise<string> {
  const rows = await client.$queryRawUnsafe<{ c: string }[]>(
    `SELECT public.sangfor_rfc8785_jcs_v1($1::jsonb) AS c`,
    JSON.stringify(value),
  );
  return rows[0]!.c;
}

async function pgSha256(client: PrismaClient, text: string): Promise<string> {
  const rows = await client.$queryRawUnsafe<{ c: string }[]>(`SELECT public.sangfor_sha256_utf8($1) AS c`, text);
  return rows[0]!.c;
}

async function pgHex(client: PrismaClient, text: string): Promise<string> {
  const rows = await client.$queryRawUnsafe<{ c: string }[]>(`SELECT encode(convert_to($1, 'UTF8'), 'hex') AS c`, text);
  return rows[0]!.c;
}

describe.skipIf(!integration)('Artifact/ArtifactVersion identity schema (integration, requires Docker + CI_INTEGRATION=1)', () => {
  beforeAll(async () => {
    let resolveReady: (databaseUrl: string) => void;
    const ready = new Promise<string>((r) => (resolveReady = r));
    let releaseCallback: (() => void) | null = null;
    const held = new Promise<void>((r) => (releaseCallback = r));

    const lifecycle = withIsolatedPostgres(
      { runId: RUN_ID, ownerUnit: 'U017', purpose: 'artifact-schema-integration', evidenceDir: EVIDENCE_DIR, imageDigest: IMAGE_DIGEST, migrate: true },
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

  describe('JS <-> PostgreSQL RFC 8785 canonicalization parity', () => {
    const vectors: Array<{ name: string; value: unknown }> = [
      { name: 'official-arrays', value: JSON.parse('[56,{"d":true,"10":null,"1":[]}]') },
      { name: 'official-structures', value: JSON.parse('{"1":{"f":{"f":"hi","F":5},"\\n":56.0},"10":{},"":"empty","a":{},"111":[{"e":"yes","E":"no"}],"A":{}}') },
      { name: 'official-unicode-nfd', value: JSON.parse('{"Unnormalized Unicode":"A\\u030a"}') },
      { name: 'official-values-numbers', value: { numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 1e-27] } },
      { name: 'weird-keys-utf16-ordering', value: JSON.parse('{"\\u20ac":1,"\\r":2,"\\n":3,"1":4,"":5,"\\ud83d\\ude02":6,"\\u00f6":7,"\\ufb33":8,"</script>":9}') },
      { name: 'negative-zero', value: { z: -0 } },
      { name: 'nested-arrays-objects', value: { list: [1, [2, 3], { a: null, b: false }], k: 'v' } },
    ];

    for (const vector of vectors) {
      it(`produces byte-identical canonical text, UTF-8 hex, and SHA-256 digest for "${vector.name}"`, async () => {
        const client = prisma!;
        const jsCanonical = canonicalizeRfc8785(vector.value);
        const pgCanonical = await pgJcs(client, vector.value);
        expect(pgCanonical).toBe(jsCanonical);

        const jsHex = Buffer.from(jsCanonical, 'utf8').toString('hex');
        const pgHexResult = await pgHex(client, pgCanonical);
        expect(pgHexResult).toBe(jsHex);

        const jsDigest = createHash('sha256').update(Buffer.from(jsCanonical, 'utf8')).digest('hex');
        const pgDigest = await pgSha256(client, pgCanonical);
        expect(pgDigest).toBe(jsDigest);
      });
    }

    it('the full envelope constructed by parseCanonicalArtifactContent matches the DB-side reconstruction from content_json for a representative payload', async () => {
      const client = prisma!;
      const raw = JSON.stringify({ title: 'parity check', tags: ['a', 'b'], score: 12.5 });
      const parsed = parseCanonicalArtifactContent(raw);
      const rows = await client.$queryRawUnsafe<{ c: string }[]>(
        `SELECT public.sangfor_rfc8785_jcs_v1(jsonb_build_object('contract','sangfor.artifact-content','payload',$1::jsonb,'version',1)) AS c`,
        raw,
      );
      expect(rows[0]!.c).toBe(parsed.canonicalContentEnvelope);
      const pgHash = await pgSha256(client, rows[0]!.c);
      expect(pgHash).toBe(parsed.contentHash);
    });
  });

  describe('positive fixture: two immutable versions under one scoped Artifact, then a CAS owner-only reassignment', () => {
    it('creates the artifact, inserts v1 then v2, reads them back ordered, and confirms the pointer stays inactive', async () => {
      const client = prisma!;
      const artifact = await client.artifact.create({
        data: {
          id: 'fx-art-happy-1',
          tenantId: 'fx-art-tenant-1',
          companyId: 'fx-art-company-1',
          projectId: 'fx-art-project-1',
          artifactType: 'proposal',
          classification: 'internal',
          origin: 'human',
          title: 'Happy Path Artifact',
          createdByAssignmentId: 'fx-art-ucr-creator',
          ownerAssignmentId: 'fx-art-ucr-owner',
        },
      });
      expect(artifact.ownershipRevision).toBe(0);
      expect(artifact.currentVersionId).toBeNull();
      expect(artifact.currentRevision).toBe(0);

      const v1Content = parseCanonicalArtifactContent(JSON.stringify({ body: 'draft one' }));
      const v2Content = parseCanonicalArtifactContent(JSON.stringify({ body: 'draft two', revised: true }));

      await client.artifactVersion.create({
        data: {
          id: 'fx-artv-happy-1',
          artifactId: artifact.id,
          version: 1,
          contentHashVersion: v1Content.contentHashVersion,
          canonicalContentEnvelope: v1Content.canonicalContentEnvelope,
          contentHash: v1Content.contentHash,
          contentJson: v1Content.contentJson as Prisma.InputJsonValue,
          status: 'ai_draft',
          createdByAssignmentId: 'fx-art-ucr-creator',
        },
      });
      await client.artifactVersion.create({
        data: {
          id: 'fx-artv-happy-2',
          artifactId: artifact.id,
          version: 2,
          contentHashVersion: v2Content.contentHashVersion,
          canonicalContentEnvelope: v2Content.canonicalContentEnvelope,
          contentHash: v2Content.contentHash,
          contentJson: v2Content.contentJson as Prisma.InputJsonValue,
          status: 'human_draft',
          createdByAssignmentId: 'fx-art-ucr-creator',
        },
      });

      const versions = await client.artifactVersion.findMany({ where: { artifactId: artifact.id }, orderBy: { version: 'asc' } });
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
      expect(versions.map((v) => v.status)).toEqual(['ai_draft', 'human_draft']);

      const reread = await client.artifact.findUniqueOrThrow({ where: { id: artifact.id } });
      expect(reread.currentVersionId).toBeNull();
      expect(reread.currentRevision).toBe(0);

      const cas = await client.artifact.update({
        where: { id: artifact.id },
        data: { ownerAssignmentId: 'fx-art-ucr-owner2', ownershipRevision: 1 },
      });
      expect(cas.ownerAssignmentId).toBe('fx-art-ucr-owner2');
      expect(cas.ownershipRevision).toBe(1);
      expect(cas.createdByAssignmentId).toBe('fx-art-ucr-creator');

      const versionsAfterCas = await client.artifactVersion.findMany({ where: { artifactId: artifact.id }, orderBy: { version: 'asc' } });
      expect(versionsAfterCas.map((v) => v.id)).toEqual(['fx-artv-happy-1', 'fx-artv-happy-2']);
      expect(cas.currentVersionId).toBeNull();
      expect(cas.currentRevision).toBe(0);
    });
  });

  describe('negative fixtures', () => {
    it('rejects an Artifact with a missing (null) owner', async () => {
      const client = prisma!;
      await expect(
        client.$executeRawUnsafe(
          `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, created_at, updated_at)
           VALUES ('fx-art-neg-owner', 'fx-art-tenant-1', 'fx-art-company-1', 'fx-art-project-1', 'proposal', 'internal', 'human', 'T', 'fx-art-ucr-creator', NULL, now(), now());`,
        ),
      ).rejects.toThrow();
    });

    it('rejects a cross-company owner assignment (composite FK)', async () => {
      const client = prisma!;
      await expect(
        client.artifact.create({
          data: {
            id: 'fx-art-neg-cross-owner',
            tenantId: 'fx-art-tenant-1',
            companyId: 'fx-art-company-1',
            projectId: 'fx-art-project-1',
            artifactType: 'proposal',
            classification: 'internal',
            origin: 'human',
            title: 'T',
            createdByAssignmentId: 'fx-art-ucr-creator',
            ownerAssignmentId: 'fx-art-ucr-cross',
          },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it('rejects a cross-company creator assignment (composite FK)', async () => {
      const client = prisma!;
      await expect(
        client.artifact.create({
          data: {
            id: 'fx-art-neg-cross-creator',
            tenantId: 'fx-art-tenant-1',
            companyId: 'fx-art-company-1',
            projectId: 'fx-art-project-1',
            artifactType: 'proposal',
            classification: 'internal',
            origin: 'human',
            title: 'T',
            createdByAssignmentId: 'fx-art-ucr-cross',
            ownerAssignmentId: 'fx-art-ucr-owner',
          },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it('rejects an ArtifactVersion whose creator assignment is outside the parent artifact\'s company (named insert guard trigger, not a Prisma FK)', async () => {
      const client = prisma!;
      const content = parseCanonicalArtifactContent(JSON.stringify({ x: 1 }));
      await expect(
        client.artifactVersion.create({
          data: {
            id: 'fx-artv-neg-cross-creator',
            artifactId: 'fx-art-happy-1',
            version: 3,
            contentHashVersion: content.contentHashVersion,
            canonicalContentEnvelope: content.canonicalContentEnvelope,
            contentHash: content.contentHash,
            contentJson: content.contentJson as Prisma.InputJsonValue,
            status: 'ai_draft',
            createdByAssignmentId: 'fx-art-ucr-cross',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects mutating the immutable createdByAssignmentId', async () => {
      const client = prisma!;
      await expect(
        client.artifact.update({ where: { id: 'fx-art-happy-1' }, data: { createdByAssignmentId: 'fx-art-ucr-owner' } }),
      ).rejects.toThrow();
    });

    it('rejects a wrong/missing content_hash_version literal', async () => {
      const client = prisma!;
      await expect(
        client.$executeRawUnsafe(
          `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at)
           VALUES ('fx-artv-neg-hashver', 'fx-art-happy-1', 3, 'artifact-content/rfc8785-jcs-sha256/v0', '{"contract":"sangfor.artifact-content","payload":{},"version":1}', repeat('0',64), '{}'::jsonb, 'ai_draft', 'fx-art-ucr-creator', now());`,
        ),
      ).rejects.toThrow();
    });

    it('rejects a non-JCS (whitespace-corrupted) envelope', async () => {
      const client = prisma!;
      await expect(
        client.$executeRawUnsafe(
          `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at)
           VALUES ('fx-artv-neg-envelope', 'fx-art-happy-1', 3, 'artifact-content/rfc8785-jcs-sha256/v1', '{"contract": "sangfor.artifact-content","payload":{},"version":1}', repeat('0',64), '{}'::jsonb, 'ai_draft', 'fx-art-ucr-creator', now());`,
        ),
      ).rejects.toThrow();
    });

    it('rejects a bad (non-matching) content_hash', async () => {
      const client = prisma!;
      await expect(
        client.$executeRawUnsafe(
          `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at)
           VALUES ('fx-artv-neg-hash', 'fx-art-happy-1', 3, 'artifact-content/rfc8785-jcs-sha256/v1', '{"contract":"sangfor.artifact-content","payload":{},"version":1}', repeat('0',64), '{}'::jsonb, 'ai_draft', 'fx-art-ucr-creator', now());`,
        ),
      ).rejects.toThrow();
    });

    it('rejects a duplicate (artifactId, version) pair', async () => {
      const client = prisma!;
      const content = parseCanonicalArtifactContent(JSON.stringify({ dup: true }));
      await expect(
        client.artifactVersion.create({
          data: {
            id: 'fx-artv-neg-dupver',
            artifactId: 'fx-art-happy-1',
            version: 1,
            contentHashVersion: content.contentHashVersion,
            canonicalContentEnvelope: content.canonicalContentEnvelope,
            contentHash: content.contentHash,
            contentJson: content.contentJson as Prisma.InputJsonValue,
            status: 'ai_draft',
            createdByAssignmentId: 'fx-art-ucr-creator',
          },
        }),
      ).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    });

    it('rejects version <= 0', async () => {
      const client = prisma!;
      const content = parseCanonicalArtifactContent(JSON.stringify({ z: true }));
      await expect(
        client.artifactVersion.create({
          data: {
            id: 'fx-artv-neg-zero',
            artifactId: 'fx-art-happy-1',
            version: 0,
            contentHashVersion: content.contentHashVersion,
            canonicalContentEnvelope: content.canonicalContentEnvelope,
            contentHash: content.contentHash,
            contentJson: content.contentJson as Prisma.InputJsonValue,
            status: 'ai_draft',
            createdByAssignmentId: 'fx-art-ucr-creator',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects an invalid classification and an invalid status', async () => {
      const client = prisma!;
      await expect(
        client.artifact.create({
          data: {
            id: 'fx-art-neg-classification',
            tenantId: 'fx-art-tenant-1',
            companyId: 'fx-art-company-1',
            projectId: 'fx-art-project-1',
            artifactType: 'proposal',
            classification: 'top-secret',
            origin: 'human',
            title: 'T',
            createdByAssignmentId: 'fx-art-ucr-creator',
            ownerAssignmentId: 'fx-art-ucr-owner',
          },
        }),
      ).rejects.toThrow();

      const content = parseCanonicalArtifactContent(JSON.stringify({ z: true }));
      await expect(
        client.artifactVersion.create({
          data: {
            id: 'fx-artv-neg-status',
            artifactId: 'fx-art-happy-1',
            version: 4,
            contentHashVersion: content.contentHashVersion,
            canonicalContentEnvelope: content.canonicalContentEnvelope,
            contentHash: content.contentHash,
            contentJson: content.contentJson as Prisma.InputJsonValue,
            status: 'not_a_real_status',
            createdByAssignmentId: 'fx-art-ucr-creator',
          },
        }),
      ).rejects.toThrow();
    });

    it('denies UPDATE and DELETE on artifact_versions (append-only)', async () => {
      const client = prisma!;
      await expect(client.artifactVersion.update({ where: { id: 'fx-artv-happy-1' }, data: { status: 'superseded' } })).rejects.toThrow();
      await expect(client.artifactVersion.delete({ where: { id: 'fx-artv-happy-1' } })).rejects.toThrow();
    });

    it('rejects a foreign-Artifact current pointer (a version that belongs to a different artifact)', async () => {
      const client = prisma!;
      await client.artifact.create({
        data: {
          id: 'fx-art-neg-pointer-owner',
          tenantId: 'fx-art-tenant-1',
          companyId: 'fx-art-company-1',
          projectId: 'fx-art-project-1',
          artifactType: 'proposal',
          classification: 'internal',
          origin: 'human',
          title: 'Other Artifact',
          createdByAssignmentId: 'fx-art-ucr-creator',
          ownerAssignmentId: 'fx-art-ucr-owner',
        },
      });
      await expect(
        client.$executeRawUnsafe(
          `UPDATE artifacts SET current_version_id = 'fx-artv-happy-1', current_revision = 1 WHERE id = 'fx-art-neg-pointer-owner';`,
        ),
      ).rejects.toThrow();
    });

    it('rejects negative ownershipRevision and negative currentRevision', async () => {
      const client = prisma!;
      await expect(client.$executeRawUnsafe(`UPDATE artifacts SET ownership_revision = -1 WHERE id = 'fx-art-happy-1';`)).rejects.toThrow();
      await expect(client.$executeRawUnsafe(`UPDATE artifacts SET current_revision = -1 WHERE id = 'fx-art-happy-1';`)).rejects.toThrow();
    });

    it('rejects an owner change without exactly ownershipRevision+1', async () => {
      const client = prisma!;
      await expect(
        client.artifact.update({ where: { id: 'fx-art-happy-1' }, data: { ownerAssignmentId: 'fx-art-ucr-owner', ownershipRevision: 1 } }),
      ).rejects.toThrow();
    });

    it('rejects an ownershipRevision change without a corresponding owner change', async () => {
      const client = prisma!;
      await expect(client.artifact.update({ where: { id: 'fx-art-happy-1' }, data: { ownershipRevision: 9 } })).rejects.toThrow();
    });

    it('rejects a pointer/revision inconsistency (currentRevision > 0 while currentVersionId stays NULL)', async () => {
      const client = prisma!;
      await expect(client.$executeRawUnsafe(`UPDATE artifacts SET current_revision = 1 WHERE id = 'fx-art-happy-1';`)).rejects.toThrow();
    });
  });

  describe('the boundary proof: a parsed jsonb value cannot evidence absent duplicate source keys', () => {
    it('jsonb collapses duplicate keys the same way JSON.parse does — a duplicate-key literal and a single-key literal produce an indistinguishable jsonb value', async () => {
      const client = prisma!;
      const collapsed = await client.$queryRawUnsafe<{ v: unknown }[]>(`SELECT '{"a":1,"a":2}'::jsonb AS v`);
      const neverHadADuplicate = await client.$queryRawUnsafe<{ v: unknown }[]>(`SELECT '{"a":2}'::jsonb AS v`);
      expect(collapsed[0]!.v).toEqual(neverHadADuplicate[0]!.v);
    });
  });
});
