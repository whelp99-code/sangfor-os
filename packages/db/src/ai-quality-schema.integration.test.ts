import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- U009's committed isolation harness is plain JS.
import { withIsolatedPostgres } from '../../scripts/lib/isolated-postgres.mjs';

const integration = process.env.CI_INTEGRATION === '1';
const HASH = 'a'.repeat(64);
const IMAGE_DIGEST = 'sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777';
let prisma: PrismaClient | undefined;
let release: (() => void) | undefined;
let lifecycle: Promise<unknown> | undefined;

const statements = [
  `SET session_replication_role = replica`,
  `INSERT INTO tenants (id, name, slug, status, created_at) VALUES ('u041-it-tenant', 'U041 Integration Tenant', 'u041-it-tenant', 'active', now())`,
  `INSERT INTO companies (id, tenant_id, name, slug, created_at) VALUES ('u041-it-company', 'u041-it-tenant', 'U041 Integration Company', 'u041-it-company', now())`,
  `INSERT INTO projects (id, slug, name, company_id, created_at, updated_at) VALUES ('u041-it-project', 'u041-it-project', 'U041 Integration Project', 'u041-it-company', now(), now())`,
  `INSERT INTO users (id, email, name, status, created_at, updated_at) VALUES ('u041-it-user', 'u041-it@example.test', 'U041 Integration User', 'active', now(), now())`,
  `INSERT INTO user_company_roles (id, user_id, company_id, role, status, valid_from, created_at) VALUES ('u041-it-assignment', 'u041-it-user', 'u041-it-company', 'account_manager', 'active', now() - interval '1 day', now())`,
  `INSERT INTO artifacts (id, tenant_id, company_id, project_id, artifact_type, classification, origin, title, created_by_assignment_id, owner_assignment_id, ownership_revision, current_revision, created_at, updated_at) VALUES ('u041-it-artifact', 'u041-it-tenant', 'u041-it-company', 'u041-it-project', 'assessment-input', 'internal', 'human', 'U041 Integration Artifact', 'u041-it-assignment', 'u041-it-assignment', 0, 0, now(), now())`,
  `INSERT INTO artifact_versions (id, artifact_id, version, content_hash_version, canonical_content_envelope, content_hash, content_json, status, created_by_assignment_id, created_at) VALUES ('u041-it-artifact-version', 'u041-it-artifact', 1, 'artifact-content/rfc8785-jcs-sha256/v1', 'u041-integration-envelope', '${HASH}', '{}'::jsonb, 'review_ready', 'u041-it-assignment', now())`,
  `SET session_replication_role = origin`,
  `INSERT INTO ai_quality_assessments (id, artifact_version_id, artifact_content_hash, result_hash, policy_key, policy_version, evaluator_key, evaluator_version, status, score, source_coverage, confidence_basis, missing_info, known_gaps, risk_flags, injection_detected, leakage_detected, quality_passed, assessed_by_assignment_id, idempotency_key, assessment_input_hash, assessed_at) VALUES ('u041-it-assessment', 'u041-it-artifact-version', '${HASH}', '${HASH}', 'quality', 'v1', 'evaluator', 'v1', 'completed', 0.8, 0.75, '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, false, false, false, 'u041-it-assignment', 'assessment-1', '${HASH}', now())`,
  `INSERT INTO ai_quality_evidence (id, assessment_id, source_kind, source_reference, source_hash, source_artifact_version_id, citation, coverage) VALUES ('u041-it-evidence', 'u041-it-assessment', 'artifact', 'u041-it-artifact-version', '${HASH}', 'u041-it-artifact-version', '{}'::jsonb, '{}'::jsonb)`,
  `INSERT INTO ai_quality_reviews (id, assessment_id, artifact_version_id, artifact_content_hash, assessment_result_hash, review_slot_key, reviewer_assignment_id, reviewer_role_snapshot, decision, comment, idempotency_key, review_input_hash) VALUES ('u041-it-review', 'u041-it-assessment', 'u041-it-artifact-version', '${HASH}', '${HASH}', 'security', 'u041-it-assignment', 'account_manager', 'approved', 'reviewed', 'review-1', '${HASH}')`,
  `INSERT INTO ai_release_evaluations (id, evaluation_key, evaluation_input_hash, review_set_hash, artifact_version_id, artifact_content_hash, assessment_id, action, policy_key, policy_version, policy_hash, eligible, blockers, evaluated_at) VALUES ('u041-it-evaluation', '${HASH}', '${HASH}', '${HASH}', 'u041-it-artifact-version', '${HASH}', 'u041-it-assessment', 'ai.review', 'quality', 'v1', '${HASH}', false, '["human_review_required"]'::jsonb, now())`,
  `INSERT INTO ai_prompt_snapshots (id, assessment_id, prompt_key, prompt_version, prompt_hash, tool_key, tool_version, tool_hash, classification) VALUES ('u041-it-prompt', 'u041-it-assessment', 'quality-prompt', 'v1', '${HASH}', 'tool', 'v1', '${HASH}', 'internal')`,
  `INSERT INTO ai_model_snapshots (id, assessment_id, model_key, model_version, model_hash, tool_key, tool_version, tool_hash, classification) VALUES ('u041-it-model', 'u041-it-assessment', 'model', 'v1', '${HASH}', 'tool', 'v1', '${HASH}', 'internal')`,
];

describe('U041 isolated AI quality schema verifier', () => {
  it('exposes all six history models before the isolated database suite is allowed to run', () => {
    for (const name of ['AiQualityAssessment', 'AiQualityEvidence', 'AiQualityReview', 'AiReleaseEvaluation', 'AiPromptSnapshot', 'AiModelSnapshot']) {
      expect(Prisma.dmmf.datamodel.models.some((model) => model.name === name)).toBe(true);
    }
  });
});

describe.skipIf(!integration)('U041 AI quality schema (U009 isolated Postgres only)', () => {
  beforeAll(async () => {
    if (process.env.DATABASE_URL) throw new Error('U041 integration verifier rejects caller DATABASE_URL');
    let ready!: (url: string) => void;
    const databaseReady = new Promise<string>((resolve) => { ready = resolve; });
    let heldRelease!: () => void;
    const held = new Promise<void>((resolve) => { heldRelease = resolve; });
    lifecycle = withIsolatedPostgres(
      { runId: `u041-it-${Date.now().toString(36)}`, ownerUnit: 'U041', purpose: 'ai-quality-schema-integration', evidenceDir: join(tmpdir(), 'u041-ai-quality-integration'), imageDigest: IMAGE_DIGEST, migrate: true },
      async (ctx: { databaseUrl: string }) => { ready(ctx.databaseUrl); await held; },
    );
    release = heldRelease;
    prisma = new PrismaClient({ datasources: { db: { url: await databaseReady } } });
    for (const sql of statements) await prisma.$executeRawUnsafe(`${sql};`);
  }, 180_000);

  afterAll(async () => {
    await prisma?.$disconnect();
    release?.();
    await lifecycle;
  }, 60_000);

  it('has exactly the two immutable functions and twelve enabled single-action authorities', async () => {
    const functions = await prisma!.$queryRawUnsafe<Array<{ proname: string }>>(
      `SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('ai_quality_history_immutable_update_reject_fn','ai_quality_history_immutable_delete_reject_fn') ORDER BY proname`,
    );
    expect(functions.map((row) => row.proname)).toEqual(['ai_quality_history_immutable_delete_reject_fn', 'ai_quality_history_immutable_update_reject_fn']);
    const triggers = await prisma!.$queryRawUnsafe<Array<{ tgname: string; table_name: string; enabled: string; definition: string }>>(
      `SELECT t.tgname, c.relname AS table_name, t.tgenabled AS enabled, pg_get_triggerdef(t.oid) AS definition
       FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
       WHERE NOT t.tgisinternal AND c.relname IN ('ai_quality_assessments','ai_quality_evidence','ai_quality_reviews','ai_release_evaluations','ai_prompt_snapshots','ai_model_snapshots')
       ORDER BY t.tgname`,
    );
    expect(triggers).toHaveLength(12);
    expect(triggers.every((row) => row.enabled === 'O' && /BEFORE (UPDATE|DELETE) ON/.test(row.definition) && !/UPDATE OR DELETE/.test(row.definition))).toBe(true);
  });

  it('allows only valid complete inserts and rejects invalid evidence, decision, action, approval-shape, and duplicate evaluation receipts', async () => {
    await expect(prisma!.$executeRawUnsafe(`INSERT INTO ai_quality_evidence (id, assessment_id, source_kind, source_reference, source_hash, citation, coverage) VALUES ('u041-it-bad-evidence', 'u041-it-assessment', 'artifact', 'missing', '${HASH}', '{}'::jsonb, '{}'::jsonb)`)).rejects.toThrow();
    await expect(prisma!.$executeRawUnsafe(`INSERT INTO ai_quality_reviews (id, assessment_id, artifact_version_id, artifact_content_hash, assessment_result_hash, review_slot_key, reviewer_assignment_id, reviewer_role_snapshot, decision, idempotency_key, review_input_hash) VALUES ('u041-it-bad-review', 'u041-it-assessment', 'u041-it-artifact-version', '${HASH}', '${HASH}', 'different', 'u041-it-assignment', 'account_manager', 'pending', 'bad-review', '${HASH}')`)).rejects.toThrow();
    await expect(prisma!.$executeRawUnsafe(`INSERT INTO ai_release_evaluations (id, evaluation_key, evaluation_input_hash, review_set_hash, artifact_version_id, artifact_content_hash, assessment_id, action, policy_key, policy_version, policy_hash, eligible, blockers, evaluated_at) VALUES ('u041-it-bad-action', '${'b'.repeat(64)}', '${HASH}', '${HASH}', 'u041-it-artifact-version', '${HASH}', 'u041-it-assessment', 'external.send', 'quality', 'v1', '${HASH}', false, '[]'::jsonb, now())`)).rejects.toThrow();
    await expect(prisma!.$executeRawUnsafe(`INSERT INTO ai_release_evaluations (id, evaluation_key, evaluation_input_hash, review_set_hash, artifact_version_id, artifact_content_hash, assessment_id, action, policy_key, policy_version, policy_hash, approval_request_id, eligible, blockers, evaluated_at) VALUES ('u041-it-partial-approval', '${'c'.repeat(64)}', '${HASH}', '${HASH}', 'u041-it-artifact-version', '${HASH}', 'u041-it-assessment', 'ai.review', 'quality', 'v1', '${HASH}', 'none', false, '[]'::jsonb, now())`)).rejects.toThrow();
    await expect(prisma!.$executeRawUnsafe(`INSERT INTO ai_release_evaluations (id, evaluation_key, evaluation_input_hash, review_set_hash, artifact_version_id, artifact_content_hash, assessment_id, action, policy_key, policy_version, policy_hash, eligible, blockers, evaluated_at) VALUES ('u041-it-duplicate-key', '${HASH}', '${'d'.repeat(64)}', '${HASH}', 'u041-it-artifact-version', '${HASH}', 'u041-it-assessment', 'ai.internal_release', 'quality', 'v1', '${HASH}', false, '[]'::jsonb, now())`)).rejects.toThrow();
  });

  it('rejects UPDATE, no-op UPDATE, and DELETE for every history table and prevents parent deletion', async () => {
    const rows: Array<[string, string]> = [
      ['ai_quality_assessments', 'u041-it-assessment'], ['ai_quality_evidence', 'u041-it-evidence'], ['ai_quality_reviews', 'u041-it-review'],
      ['ai_release_evaluations', 'u041-it-evaluation'], ['ai_prompt_snapshots', 'u041-it-prompt'], ['ai_model_snapshots', 'u041-it-model'],
    ];
    for (const [table, id] of rows) {
      await expect(prisma!.$executeRawUnsafe(`UPDATE ${table} SET id = id WHERE id = '${id}'`)).rejects.toThrow(/immutable/);
      await expect(prisma!.$executeRawUnsafe(`DELETE FROM ${table} WHERE id = '${id}'`)).rejects.toThrow(/immutable/);
    }
    await expect(prisma!.$executeRawUnsafe(`DELETE FROM artifact_versions WHERE id = 'u041-it-artifact-version'`)).rejects.toThrow();
    expect(await prisma!.aiQualityAssessment.count({ where: { id: 'u041-it-assessment' } })).toBe(1);
  });
});
