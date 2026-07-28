import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { dmmfField, dmmfIndex, dmmfModel, executableSql } from './helpers';

const U034_MIGRATION_NAME = '20260716003400_u034_qualification_bant_tf_expand';
const U034_MIGRATION_PATH = join(__dirname, '../../prisma/migrations', U034_MIGRATION_NAME, 'migration.sql');

export const QUALIFICATION_SCORING_CONTRACT = Object.freeze({
  scoringVersion: 'bant-tf-v1',
  total: { minimum: 0, maximum: 100, integer: true },
  caps: { budget: 20, authority: 20, need: 24, timeline: 16, technicalFit: 20 },
  passThreshold: 60,
});

function readU034Migration(): string {
  return readFileSync(U034_MIGRATION_PATH, 'utf8');
}

function expectScalar(field: string, type: string, dbName: string) {
  const candidate = dmmfField('DealQualification', field);
  expect(candidate.kind).toBe('scalar');
  expect(candidate.type).toBe(type);
  expect(candidate.isRequired).toBe(false);
  expect(candidate.dbName).toBe(dbName);
  return candidate;
}

describe('U034 BANT plus Technical-Fit qualification DMMF contract', () => {
  it('adds nullable Technical-Fit scoring', () => {
    expectScalar('technicalFitScore', 'Int', 'technical_fit_score');
  });

  it('adds a nullable integer score total', () => {
    expectScalar('scoreTotal', 'Int', 'score_total');
  });

  it('adds a nullable canonical scoring version', () => {
    expectScalar('scoringVersion', 'String', 'scoring_version');
  });

  it('adds a nullable positive revision snapshot', () => {
    expectScalar('revision', 'Int', 'revision');
  });

  it('adds nullable assessment provenance on the existing qualification record', () => {
    expectScalar('assessedByAssignmentId', 'String', 'assessed_by_assignment_id');
    expectScalar('assessedAt', 'DateTime', 'assessed_at');
    expectScalar('updatedAt', 'DateTime', 'updated_at');
    expectScalar('snapshotHash', 'String', 'snapshot_hash');

    const assessment = dmmfField('DealQualification', 'assessedByAssignment');
    expect(assessment.kind).toBe('object');
    expect(assessment.type).toBe('UserCompanyRole');
    expect(assessment.isRequired).toBe(false);
    expect(assessment.relationName).toBe('DealQualificationAssessedByAssignment');
    expect(assessment.relationFromFields).toEqual(['assessedByAssignmentId']);
    expect(assessment.relationOnDelete).toBe('SetNull');
    expect(dmmfField('UserCompanyRole', 'assessedDealQualifications').relationName).toBe('DealQualificationAssessedByAssignment');
    expect(dmmfIndex('DealQualification', ['assessedByAssignmentId'])).toBe(true);
  });

  it('preserves the original BANT record and its one-to-one opportunity relation', () => {
    const opportunityId = dmmfField('DealQualification', 'opportunityId');
    expect(opportunityId.isUnique).toBe(true);
    expect(opportunityId.dbName).toBe('opportunity_id');
    for (const [field, type] of [
      ['budgetScore', 'Int'],
      ['authorityScore', 'Int'],
      ['needScore', 'Int'],
      ['timelineScore', 'Int'],
      ['weightedScore', 'Float'],
      ['passed', 'Boolean'],
      ['qualifiedAt', 'DateTime'],
      ['qualifiedBy', 'String'],
      ['notes', 'String'],
      ['economicBuyerId', 'String'],
      ['championId', 'String'],
    ] as const) expect(dmmfField('DealQualification', field).type).toBe(type);
    expect(dmmfField('DealQualification', 'opportunity').type).toBe('Opportunity');
  });

  it('records the immutable scoring contract without creating a qualification history model', () => {
    expect(QUALIFICATION_SCORING_CONTRACT).toEqual({
      scoringVersion: 'bant-tf-v1',
      total: { minimum: 0, maximum: 100, integer: true },
      caps: { budget: 20, authority: 20, need: 24, timeline: 16, technicalFit: 20 },
      passThreshold: 60,
    });
    const qualificationModels = Prisma.dmmf.datamodel.models
      .map(({ name }) => name)
      .filter((name) => name === 'DealQualification' || /(qualification|bant|technicalfit)/i.test(name));
    expect(qualificationModels).toEqual(['DealQualification']);
  });

  it('types a canonical BANT plus Technical-Fit draft while retaining a legacy BANT row shape', () => {
    const legacy: Prisma.DealQualificationCreateInput = {
      budgetScore: 10,
      authorityScore: 10,
      needScore: 12,
      timelineScore: 8,
      weightedScore: 40,
      opportunity: { connect: { id: 'opportunity-legacy' } },
    };
    const canonical: Prisma.DealQualificationCreateInput = {
      ...legacy,
      technicalFitScore: 15,
      scoreTotal: 75,
      scoringVersion: QUALIFICATION_SCORING_CONTRACT.scoringVersion,
      revision: 1,
      assessedByAssignment: { connect: { id: 'assignment-a' } },
      assessedAt: new Date('2026-07-16T00:00:00.000Z'),
      snapshotHash: 'snapshot-hash',
    };
    expect(legacy.technicalFitScore).toBeUndefined();
    expect(canonical.scoreTotal).toBe(75);
  });
});

describe('U034 expand migration safety contract', () => {
  it('is additive, preserves legacy rows, and adds every new write constraint as NOT VALID', () => {
    const sql = readU034Migration();
    const executable = executableSql(sql);
    expect(executable).not.toMatch(/(?:^|;)\s*(?:INSERT\s+INTO|UPDATE\s+["a-z_]+|DELETE\s+FROM)\b/im);
    expect(executable).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN|INDEX|CONSTRAINT|FUNCTION|TRIGGER)\b/i);
    expect(executable).not.toMatch(/\bSET\s+NOT\s+NULL\b/i);
    expect(executable).not.toMatch(/\bVALIDATE\s+CONSTRAINT\b/i);
    for (const [name, column, maximum] of [
      ['deal_qualifications_budget_score_bant_tf_range_chk', 'budget_score', 20],
      ['deal_qualifications_authority_score_bant_tf_range_chk', 'authority_score', 20],
      ['deal_qualifications_need_score_bant_tf_range_chk', 'need_score', 24],
      ['deal_qualifications_timeline_score_bant_tf_range_chk', 'timeline_score', 16],
      ['deal_qualifications_technical_fit_score_bant_tf_range_chk', 'technical_fit_score', 20],
      ['deal_qualifications_score_total_bant_tf_range_chk', 'score_total', 100],
    ] as const) {
      expect(sql).toMatch(new RegExp(`ADD CONSTRAINT "${name}"\\s+CHECK \\("${column}" >= 0 AND "${column}" <= ${maximum}\\) NOT VALID`));
    }
    expect(sql).toMatch(/ADD CONSTRAINT "deal_qualifications_revision_bant_tf_positive_chk"\s+CHECK \("revision" IS NULL OR "revision" > 0\) NOT VALID;/);
    expect(sql).toMatch(/FOREIGN KEY \("assessed_by_assignment_id"\) REFERENCES "user_company_roles"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE;/);
    expect(sql).toMatch(/CREATE INDEX "deal_qualifications_assessed_by_assignment_id_idx"/);
  });
});
