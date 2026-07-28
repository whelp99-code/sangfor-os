import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { MODEL_SCOPE_INVENTORY, buildScopeInventoryReport } from './scope-inventory';

const U041_MIGRATION = join(__dirname, '../prisma/migrations/20260716004100_u041_ai_quality_artifact_expand/migration.sql');
const HASH = 'a'.repeat(64);
const HISTORY_MODELS = ['AiQualityAssessment', 'AiQualityEvidence', 'AiQualityReview', 'AiReleaseEvaluation', 'AiPromptSnapshot', 'AiModelSnapshot'] as const;

function model(name: string) {
  const found = Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing Prisma model ${name}`);
  return found;
}

function field(modelName: string, fieldName: string) {
  const found = model(modelName).fields.find((candidate) => candidate.name === fieldName);
  if (!found) throw new Error(`missing ${modelName}.${fieldName}`);
  return found;
}

function migration(): string {
  return readFileSync(U041_MIGRATION, 'utf8');
}

describe('U041 AI quality artifact-linked schema contract', () => {
  it('keeps AiQualityResult as the golden-answer result table and adds exactly six immutable history models', () => {
    expect(model('AiQualityResult')).toBeDefined();
    for (const name of HISTORY_MODELS) expect(model(name)).toBeDefined();
    const fields = HISTORY_MODELS.flatMap((name) => model(name).fields.map((candidate) => candidate.name.toLowerCase()));
    expect(fields.some((name) => /secret|credential|api[_-]?key|token/.test(name))).toBe(false);
  });

  it('pins completed assessments to one immutable ArtifactVersion with exact receipt identity', () => {
    for (const name of ['artifactVersionId', 'artifactContentHash', 'resultHash', 'policyKey', 'policyVersion', 'evaluatorKey', 'evaluatorVersion', 'status', 'score', 'sourceCoverage', 'confidenceBasis', 'missingInfo', 'knownGaps', 'riskFlags', 'injectionDetected', 'leakageDetected', 'qualityPassed', 'assessedByAssignmentId', 'idempotencyKey', 'assessmentInputHash', 'assessedAt', 'createdAt']) {
      expect(field('AiQualityAssessment', name).isRequired).toBe(true);
    }
    expect(field('AiQualityAssessment', 'artifactVersion').relationOnDelete).toBe('Restrict');
    expect(field('AiQualityAssessment', 'assessedByAssignment').relationOnDelete).toBe('Restrict');
    expect(field('AiQualityAssessment', 'status').default).toBe('completed');
    expect(model('AiQualityAssessment').uniqueFields).toContainEqual(['artifactVersionId', 'assessedByAssignmentId', 'idempotencyKey']);
  });

  it('preserves exact evidence, review, evaluation, prompt, and model receipt shapes', () => {
    for (const name of ['assessmentId', 'sourceKind', 'sourceReference', 'sourceHash', 'citation', 'coverage', 'createdAt']) expect(field('AiQualityEvidence', name).isRequired).toBe(true);
    expect(field('AiQualityEvidence', 'assessment').relationOnDelete).toBe('Restrict');
    expect(field('AiQualityEvidence', 'sourceArtifactVersionId').isRequired).toBe(false);

    for (const name of ['assessmentId', 'artifactVersionId', 'artifactContentHash', 'assessmentResultHash', 'reviewSlotKey', 'reviewerAssignmentId', 'reviewerRoleSnapshot', 'decision', 'idempotencyKey', 'reviewInputHash', 'createdAt']) expect(field('AiQualityReview', name).isRequired).toBe(true);
    expect(field('AiQualityReview', 'comment').isRequired).toBe(false);
    for (const relation of ['assessment', 'artifactVersion', 'reviewerAssignment']) expect(field('AiQualityReview', relation).relationOnDelete).toBe('Restrict');
    expect(model('AiQualityReview').uniqueFields).toEqual(expect.arrayContaining([['assessmentId', 'reviewSlotKey'], ['assessmentId', 'reviewerAssignmentId', 'idempotencyKey']]));

    for (const name of ['evaluationKey', 'evaluationInputHash', 'reviewSetHash', 'artifactVersionId', 'artifactContentHash', 'assessmentId', 'action', 'policyKey', 'policyVersion', 'policyHash', 'eligible', 'blockers', 'evaluatedAt', 'createdAt']) expect(field('AiReleaseEvaluation', name).isRequired).toBe(true);
    for (const name of ['approvalRequestId', 'approvalRequestRevision', 'approvalArtifactHashSnapshot', 'approvalPolicyHashSnapshot']) expect(field('AiReleaseEvaluation', name).isRequired).toBe(false);
    expect(field('AiReleaseEvaluation', 'evaluationKey').isUnique).toBe(true);
    for (const relation of ['assessment', 'artifactVersion', 'approvalRequest']) expect(field('AiReleaseEvaluation', relation).relationOnDelete).toBe('Restrict');

    for (const name of ['AiPromptSnapshot', 'AiModelSnapshot']) {
      expect(field(name, 'assessmentId').isRequired).toBe(true);
      expect(field(name, 'assessment').relationOnDelete).toBe('Restrict');
    }
  });

  it('registers all six names exactly once in the sole canonical inventory', () => {
    const names = Prisma.dmmf.datamodel.models.map((candidate) => candidate.name);
    const entries = Object.values(MODEL_SCOPE_INVENTORY);
    expect(buildScopeInventoryReport(names, entries).ok).toBe(true);
    for (const name of HISTORY_MODELS) expect(entries.filter((entry) => entry.model === name)).toHaveLength(1);
  });

  it('declares exact checks, unique receipt identities, restrictive FKs, and no mutable-history escape hatch', () => {
    const sql = migration();
    for (const hashColumn of ['artifact_content_hash', 'result_hash', 'assessment_input_hash', 'source_hash', 'assessment_result_hash', 'review_input_hash', 'evaluation_key', 'evaluation_input_hash', 'review_set_hash', 'policy_hash', 'prompt_hash', 'model_hash', 'tool_hash']) {
      expect(sql).toContain(`"${hashColumn}" ~ '^[0-9a-f]{64}$'`);
    }
    expect(HASH).toMatch(/^[0-9a-f]{64}$/);
    for (const literal of ["'completed'", "'approved'", "'rejected'", "'ai.review'", "'ai.internal_release'", "'ai.customer_send'", "'quote.internal_release'"]) expect(sql).toContain(literal);
    expect(sql).toContain('"source_kind" <> \'artifact\' OR "source_artifact_version_id" IS NOT NULL');
    expect(sql).toContain('"approval_request_id" IS NULL AND "approval_request_revision" IS NULL');
    expect(sql).toContain('UNIQUE ("artifact_version_id", "assessed_by_assignment_id", "idempotency_key")');
    expect(sql).toContain('UNIQUE ("assessment_id", "review_slot_key")');
    expect(sql).toContain('UNIQUE ("assessment_id", "reviewer_assignment_id", "idempotency_key")');
    expect(sql).toContain('UNIQUE ("evaluation_key")');
    expect(sql).toContain('ON DELETE RESTRICT');
  });

  it('installs exactly the two shared reject functions and twelve single-action BEFORE triggers', () => {
    const sql = migration();
    const functions = ['public.ai_quality_history_immutable_update_reject_fn()', 'public.ai_quality_history_immutable_delete_reject_fn()'];
    for (const name of functions) expect(sql).toContain(name);
    const triggers = [
      'ai_quality_assessments_immutable_update_trg', 'ai_quality_assessments_immutable_delete_trg',
      'ai_quality_evidence_immutable_update_trg', 'ai_quality_evidence_immutable_delete_trg',
      'ai_quality_reviews_immutable_update_trg', 'ai_quality_reviews_immutable_delete_trg',
      'ai_release_evaluations_immutable_update_trg', 'ai_release_evaluations_immutable_delete_trg',
      'ai_prompt_snapshots_immutable_update_trg', 'ai_prompt_snapshots_immutable_delete_trg',
      'ai_model_snapshots_immutable_update_trg', 'ai_model_snapshots_immutable_delete_trg',
    ];
    for (const name of triggers) expect(sql.match(new RegExp(`CREATE TRIGGER ${name}\\b`, 'g'))).toHaveLength(1);
    expect(sql).not.toMatch(/BEFORE UPDATE OR DELETE ON "ai_/);
  });
});
