import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { ARTIFACT_CONTENT_HASH_VERSION, CanonicalContentError, parseCanonicalArtifactContent } from './canonical-content-hash';
import * as CanonicalContentHash from './canonical-content-hash';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../prisma/migrations/20260715170000_artifact_identity/migration.sql'),
  'utf8',
);

function dmmfModel(name: string) {
  const model = Prisma.dmmf.datamodel.models.find((m) => m.name === name);
  if (!model) throw new Error(`DMMF model "${name}" not found — has the schema been generated?`);
  return model;
}

function dmmfField(modelName: string, fieldName: string) {
  const field = dmmfModel(modelName).fields.find((f) => f.name === fieldName);
  if (!field) throw new Error(`DMMF field "${modelName}.${fieldName}" not found`);
  return field;
}

describe('[SCHEMA ASSERTION] Artifact — DMMF', () => {
  it('ownerAssignmentId is a required (mutable, non-optional) scalar field', () => {
    const field = dmmfField('Artifact', 'ownerAssignmentId');
    expect(field.type).toBe('String');
    expect(field.isRequired).toBe(true);
    expect(field.isId).toBe(false);
  });

  it('ownershipRevision is Int with a canonical default of 0', () => {
    const field = dmmfField('Artifact', 'ownershipRevision');
    expect(field.type).toBe('Int');
    expect(field.hasDefaultValue).toBe(true);
    expect(field.default).toBe(0);
  });

  it('currentVersionId is nullable', () => {
    const field = dmmfField('Artifact', 'currentVersionId');
    expect(field.type).toBe('String');
    expect(field.isRequired).toBe(false);
  });

  it('currentRevision is Int with a default of 0', () => {
    const field = dmmfField('Artifact', 'currentRevision');
    expect(field.type).toBe('Int');
    expect(field.hasDefaultValue).toBe(true);
    expect(field.default).toBe(0);
  });

  it('createdByAssignmentId is a required scalar (immutability is DB-trigger enforced, not a Prisma-level readonly concept)', () => {
    const field = dmmfField('Artifact', 'createdByAssignmentId');
    expect(field.isRequired).toBe(true);
  });

  it('uses the exact U012 same-company composite assignment relation for createdByAssignment: fields [createdByAssignmentId, companyId] -> references [id, companyId], never an ID-only FK', () => {
    const model = dmmfModel('Artifact');
    const rel = model.fields.find((f) => f.name === 'createdByAssignment');
    expect(rel).toBeDefined();
    expect(rel!.relationFromFields).toEqual(['createdByAssignmentId', 'companyId']);
    expect(rel!.relationToFields).toEqual(['id', 'companyId']);
    expect(rel!.relationFromFields!.length).toBeGreaterThan(1);
  });

  it('uses the exact U012 same-company composite assignment relation for ownerAssignment: fields [ownerAssignmentId, companyId] -> references [id, companyId], never an ID-only FK, and is a DISTINCT relation from createdByAssignment', () => {
    const model = dmmfModel('Artifact');
    const rel = model.fields.find((f) => f.name === 'ownerAssignment');
    expect(rel).toBeDefined();
    expect(rel!.relationFromFields).toEqual(['ownerAssignmentId', 'companyId']);
    expect(rel!.relationToFields).toEqual(['id', 'companyId']);
    const createdByRel = model.fields.find((f) => f.name === 'createdByAssignment');
    expect(rel!.relationName).not.toBe(createdByRel!.relationName);
  });

  it('has no ID-only assignment relation anywhere on the model (every relation targeting UserCompanyRole carries exactly 2 FK columns)', () => {
    const model = dmmfModel('Artifact');
    const ucrRelations = model.fields.filter((f) => f.kind === 'object' && f.type === 'UserCompanyRole');
    expect(ucrRelations.length).toBe(2);
    for (const rel of ucrRelations) {
      expect(rel.relationFromFields!.length).toBe(2);
    }
  });
});

describe('[SCHEMA ASSERTION] Artifact — same-Artifact current-version pointer constraint', () => {
  it('the pointer guard trigger is installed and checks the pointed-to version belongs to the same artifact', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE TRIGGER sangfor_artifacts_guard_trg\s*\nBEFORE INSERT OR UPDATE ON artifacts/);
    expect(MIGRATION_SQL).toContain('sangfor_artifacts_guard');
    expect(MIGRATION_SQL).toMatch(/current_version_id.*belongs to artifact/s);
  });

  it('a currentVersionId/currentRevision coupling CHECK is installed (NULL<->0, NOT NULL<->positive)', () => {
    expect(MIGRATION_SQL).toContain('artifacts_pointer_revision_coupling_check');
    expect(MIGRATION_SQL).toMatch(/current_version_id IS NULL AND current_revision = 0/);
    expect(MIGRATION_SQL).toMatch(/current_version_id IS NOT NULL AND current_revision > 0/);
  });

  it('ownership_revision and current_revision each carry their own non-negative CHECK, kept separate', () => {
    expect(MIGRATION_SQL).toContain('artifacts_ownership_revision_check');
    expect(MIGRATION_SQL).toContain('artifacts_current_revision_check');
    expect(MIGRATION_SQL).toMatch(/CHECK \(ownership_revision >= 0\)/);
    expect(MIGRATION_SQL).toMatch(/CHECK \(current_revision >= 0\)/);
  });
});

describe('[SCHEMA ASSERTION] Artifact — immutable creator / CAS ownership enforcement', () => {
  it('migration.sql declares the immutable-creator trigger check', () => {
    expect(MIGRATION_SQL).toMatch(/created_by_assignment_id is immutable/i);
  });

  it('migration.sql declares the exactly-plus-one CAS ownership-revision rule', () => {
    expect(MIGRATION_SQL).toMatch(/ownership_revision IS DISTINCT FROM OLD\.ownership_revision \+ 1/);
  });

  it('migration.sql declares the reverse rule: ownership_revision may not change without owner_assignment_id changing', () => {
    expect(MIGRATION_SQL).toMatch(/ownership_revision changed without a corresponding owner_assignment_id change/);
  });
});

describe('[SCHEMA ASSERTION] ArtifactVersion — DMMF (CHILD_VIA_FK, no redundant companyId)', () => {
  it('has no companyId column at all', () => {
    const model = dmmfModel('ArtifactVersion');
    expect(model.fields.some((f) => f.name === 'companyId')).toBe(false);
  });

  it('artifactId is the sole mandatory relation basis, targeting Artifact', () => {
    const model = dmmfModel('ArtifactVersion');
    const rel = model.fields.find((f) => f.name === 'artifact');
    expect(rel).toBeDefined();
    expect(rel!.type).toBe('Artifact');
    expect(rel!.relationFromFields).toEqual(['artifactId']);
    expect(rel!.isRequired).toBe(true);
  });

  it('createdByAssignmentId is a plain required scalar with NO Prisma-level relation to UserCompanyRole (the named insert guard trigger enforces same-company membership instead)', () => {
    const model = dmmfModel('ArtifactVersion');
    const scalarField = model.fields.find((f) => f.name === 'createdByAssignmentId');
    expect(scalarField).toBeDefined();
    expect(scalarField!.kind).toBe('scalar');
    expect(scalarField!.isRequired).toBe(true);
    const anyUcrRelation = model.fields.some((f) => f.kind === 'object' && f.type === 'UserCompanyRole');
    expect(anyUcrRelation).toBe(false);
  });

  it('the named insert guard trigger joins artifactId -> artifacts.company_id and checks created_by_assignment_id against user_company_roles in that company', () => {
    expect(MIGRATION_SQL).toContain('sangfor_artifact_versions_creator_company_guard_trg');
    expect(MIGRATION_SQL).toMatch(/SELECT company_id INTO v_artifact_company_id FROM artifacts WHERE id = NEW\.artifact_id/);
    expect(MIGRATION_SQL).toMatch(/FROM user_company_roles\s*\n\s*WHERE id = NEW\.created_by_assignment_id AND company_id = v_artifact_company_id/);
  });

  it('required content fields: contentHashVersion, canonicalContentEnvelope, contentHash, contentJson, status all required; sanitizedText optional', () => {
    for (const name of ['contentHashVersion', 'canonicalContentEnvelope', 'contentHash', 'contentJson', 'status']) {
      expect(dmmfField('ArtifactVersion', name).isRequired).toBe(true);
    }
    expect(dmmfField('ArtifactVersion', 'sanitizedText').isRequired).toBe(false);
  });

  it('exposes exactly the (artifactId,version), (artifactId,contentHashVersion,contentHash), and legacy-source unique constraints', () => {
    const model = dmmfModel('ArtifactVersion');
    const uniqueFieldSets = model.uniqueIndexes.map((u) => [...u.fields].sort());
    expect(uniqueFieldSets).toContainEqual(['artifactId', 'version'].sort());
    expect(uniqueFieldSets).toContainEqual(['artifactId', 'contentHash', 'contentHashVersion'].sort());
    expect(uniqueFieldSets).toContainEqual(['legacySourceId', 'legacySourceType'].sort());
  });
});

describe('[SCHEMA ASSERTION] append-only ArtifactVersion — DENY UPDATE/DELETE', () => {
  it('migration.sql installs a deny-mutation trigger on both UPDATE and DELETE', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE TRIGGER sangfor_artifact_versions_deny_update_trg\s*\nBEFORE UPDATE ON artifact_versions/);
    expect(MIGRATION_SQL).toMatch(/CREATE TRIGGER sangfor_artifact_versions_deny_delete_trg\s*\nBEFORE DELETE ON artifact_versions/);
    expect(MIGRATION_SQL).toMatch(/is append-only/);
  });
});

describe('[SCHEMA ASSERTION] content-hash version / envelope / JCS / UTF-8 DB functions and parsed-I-JSON guard', () => {
  it('installs sangfor_rfc8785_jcs_v1(jsonb) -> text', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.sangfor_rfc8785_jcs_v1\(v jsonb\)\s*\nRETURNS text/);
  });

  it('installs sangfor_sha256_utf8(text) -> text', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.sangfor_sha256_utf8\(t text\)\s*\nRETURNS text/);
  });

  it('the content guard trigger reconstructs the envelope from the ALREADY-PARSED content_json and requires byte equality, fixes the version literal, and verifies the hash', () => {
    expect(MIGRATION_SQL).toContain('sangfor_artifact_version_content_guard_trg');
    expect(MIGRATION_SQL).toMatch(/jsonb_build_object\('contract', 'sangfor\.artifact-content', 'payload', NEW\.content_json, 'version', 1\)/);
    expect(MIGRATION_SQL).toMatch(/canonical_content_envelope IS DISTINCT FROM v_recomputed_envelope/);
    expect(MIGRATION_SQL).toMatch(/content_hash IS DISTINCT FROM v_recomputed_hash/);
  });

  it('CHECK constraints fix the exact content_hash_version literal and the 64-lowercase-hex content_hash format', () => {
    expect(MIGRATION_SQL).toContain(`CHECK (content_hash_version = '${ARTIFACT_CONTENT_HASH_VERSION}')`);
    expect(MIGRATION_SQL).toContain("CHECK (content_hash ~ '^[0-9a-f]{64}$')");
  });

  it('positive version and allowed status/classification/origin vocabularies are DB-enforced', () => {
    expect(MIGRATION_SQL).toContain('CHECK (version > 0)');
    expect(MIGRATION_SQL).toContain("CHECK (status IN ('ai_draft', 'human_draft', 'review_ready', 'superseded', 'legacy_unreviewed'))");
    expect(MIGRATION_SQL).toContain("CHECK (classification IN ('public', 'internal', 'confidential', 'restricted'))");
    expect(MIGRATION_SQL).toContain("CHECK (origin IN ('human', 'ai', 'legacy_import'))");
  });

  it('the migration explicitly documents that it does NOT claim post-jsonb duplicate-key detection', () => {
    expect(MIGRATION_SQL).toMatch(/cannot detect duplicate source object keys/i);
  });

  it('no migration statement populates the current-version pointer or changes an owner (schema only)', () => {
    expect(MIGRATION_SQL).not.toMatch(/UPDATE\s+"?artifacts"?\s+SET\s+"?current_version_id"?/i);
    expect(MIGRATION_SQL).not.toMatch(/UPDATE\s+"?artifacts"?\s+SET\s+"?owner_assignment_id"?/i);
    expect(MIGRATION_SQL).not.toMatch(/INSERT INTO\s+"?artifacts"?/i);
    expect(MIGRATION_SQL).not.toMatch(/INSERT INTO\s+"?artifact_versions"?/i);
  });
});

describe('[SCHEMA ASSERTION] exact raw-ingress parser export + duplicate-key vector coverage', () => {
  it('canonical-content-hash.ts exports exactly parseCanonicalArtifactContent and canonicalizeRfc8785 (plus the fixed contract constants and error type) — no internal tokenizer leaks', () => {
    expect(typeof CanonicalContentHash.parseCanonicalArtifactContent).toBe('function');
    expect(typeof CanonicalContentHash.canonicalizeRfc8785).toBe('function');
    expect(Object.keys(CanonicalContentHash).sort()).toEqual(
      ['ARTIFACT_CONTENT_CONTRACT', 'ARTIFACT_CONTENT_HASH_VERSION', 'CanonicalContentError', 'canonicalizeRfc8785', 'parseCanonicalArtifactContent'].sort(),
    );
  });

  it('rejects a top-level duplicate key, a nested duplicate key, and an escape-equivalent duplicate key before any value is built', () => {
    for (const raw of ['{"a":1,"a":2}', '{"outer":{"x":1,"x":2}}', '{"a":1,"\\u0061":2}']) {
      let caught: unknown;
      try {
        parseCanonicalArtifactContent(raw);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(CanonicalContentError);
      expect((caught as CanonicalContentError).code).toBe('DUPLICATE_KEY');
    }
  });
});
