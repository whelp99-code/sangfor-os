import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../prisma/migrations/20260715180000_version_bound_approval/migration.sql'),
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

describe('[SCHEMA ASSERTION] ApprovalRequest — legacy_unbound shape', () => {
  it('legacyUnbound is Boolean, required, with a default of true', () => {
    const field = dmmfField('ApprovalRequest', 'legacyUnbound');
    expect(field.type).toBe('Boolean');
    expect(field.isRequired).toBe(true);
    expect(field.hasDefaultValue).toBe(true);
    expect(field.default).toBe(true);
    expect(field.dbName).toBe('legacy_unbound');
  });

  it('migration.sql declares legacy_unbound as BOOLEAN NOT NULL DEFAULT TRUE', () => {
    expect(MIGRATION_SQL).toMatch(/ALTER TABLE "approval_requests" ALTER COLUMN "legacy_unbound" SET NOT NULL;/);
    expect(MIGRATION_SQL).toMatch(/ALTER TABLE "approval_requests" ALTER COLUMN "legacy_unbound" SET DEFAULT true;/);
  });

  it('migration.sql explicitly backfills every pre-existing row to true BEFORE the NOT NULL check, never inferring false from status/reason/command_run_id/pull_request_id', () => {
    const addCol = MIGRATION_SQL.indexOf('ADD COLUMN "legacy_unbound" BOOLEAN;');
    const backfill = MIGRATION_SQL.indexOf('UPDATE "approval_requests" SET "legacy_unbound" = true WHERE "legacy_unbound" IS NULL;');
    const notNull = MIGRATION_SQL.indexOf('ALTER COLUMN "legacy_unbound" SET NOT NULL;');
    expect(addCol).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(addCol);
    expect(notNull).toBeGreaterThan(backfill);

    // Every SET clause that ASSIGNS legacy_unbound (as opposed to a WHERE-clause read, e.g. the
    // partial-index predicate below) must be exactly the single literal `= true` backfill above
    // — never a computed/CASE expression over another legacy column.
    const assignments = [...MIGRATION_SQL.matchAll(/SET\s+"legacy_unbound"\s*=\s*[^,;\n]+/g)].map((m) => m[0]);
    expect(assignments).toEqual(['SET "legacy_unbound" = true WHERE "legacy_unbound" IS NULL']);
  });
});

describe('[SCHEMA ASSERTION] ApprovalRequest — the two-branch canonical-shape guard', () => {
  it('installs the named approval_requests_canonical_shape_guard trigger BEFORE INSERT OR UPDATE', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE TRIGGER approval_requests_canonical_shape_guard_trg\s*\nBEFORE INSERT OR UPDATE ON approval_requests/);
    expect(MIGRATION_SQL).toContain('CREATE OR REPLACE FUNCTION public.approval_requests_canonical_shape_guard()');
  });

  it('the true branch requires every canonical field NULL and ownership_revision=revision=0', () => {
    expect(MIGRATION_SQL).toMatch(/IF NEW\.legacy_unbound THEN/);
    expect(MIGRATION_SQL).toMatch(/legacy_unbound=true rows must have every canonical field NULL and ownership_revision=revision=0/);
  });

  it('the false branch requires every canonical field complete and consistent, and status begins exactly pending on INSERT', () => {
    expect(MIGRATION_SQL).toMatch(/legacy_unbound=false rows require every canonical field to be complete/);
    expect(MIGRATION_SQL).toMatch(/TG_OP = 'INSERT' AND NEW\.status IS DISTINCT FROM 'pending'/);
  });

  it('the false branch validates scope + artifact-hash consistency against the referenced ArtifactVersion/Artifact', () => {
    expect(MIGRATION_SQL).toMatch(/FROM artifact_versions av\s*\n\s*JOIN artifacts a ON a\.id = av\.artifact_id/);
    expect(MIGRATION_SQL).toMatch(/scope mismatch/);
    expect(MIGRATION_SQL).toMatch(/version\/hash mismatch/);
  });

  it('declares the flag/requester/version/scope/policy immutability checks', () => {
    expect(MIGRATION_SQL).toMatch(/approval_requests\.legacy_unbound is immutable/);
    expect(MIGRATION_SQL).toMatch(/approval_requests\.requested_by_assignment_id is immutable/);
    expect(MIGRATION_SQL).toMatch(/approval_requests\.requested_session_id is immutable/);
    expect(MIGRATION_SQL).toMatch(/approval_requests\.artifact_version_id is immutable/);
    expect(MIGRATION_SQL).toMatch(/approval_requests\.action is immutable/);
    expect(MIGRATION_SQL).toMatch(/approval_requests\.artifact_hash_snapshot is immutable/);
    expect(MIGRATION_SQL).toMatch(/scope \(tenant_id\/company_id\/project_id\) is immutable/);
    expect(MIGRATION_SQL).toMatch(/policy snapshot \(policy_key\/policy_version\/policy_hash\) is immutable/);
  });

  it('declares the exactly-plus-one owner CAS rule (same shape as Artifact.ownerAssignmentId)', () => {
    expect(MIGRATION_SQL).toMatch(/ownership_revision IS DISTINCT FROM OLD\.ownership_revision \+ 1/);
    expect(MIGRATION_SQL).toMatch(/ownership_revision changed without a corresponding owner_assignment_id change/);
  });
});

describe('[SCHEMA ASSERTION] ApprovalRequest — unchanged pre-U022 legacy writer omission', () => {
  it('ownerAssignmentId is mutable (no @updatedAt-like readonly marker) and ownershipRevision defaults to 0', () => {
    const owner = dmmfField('ApprovalRequest', 'ownerAssignmentId');
    expect(owner.isRequired).toBe(false);
    const rev = dmmfField('ApprovalRequest', 'ownershipRevision');
    expect(rev.type).toBe('Int');
    expect(rev.hasDefaultValue).toBe(true);
    expect(rev.default).toBe(0);
  });

  it('revision is Int with a default of 0, separate from ownershipRevision', () => {
    const revision = dmmfField('ApprovalRequest', 'revision');
    expect(revision.type).toBe('Int');
    expect(revision.hasDefaultValue).toBe(true);
    expect(revision.default).toBe(0);
    expect(revision.name).not.toBe('ownershipRevision');
  });

  it('every new canonical scalar field is nullable at the Prisma layer (nullable-for-expand — the shape guard trigger enforces non-null together, not Prisma optionality)', () => {
    for (const name of [
      'tenantId', 'companyId', 'projectId', 'artifactVersionId', 'action', 'artifactHashSnapshot',
      'requestedByAssignmentId', 'requestedSessionId', 'policyKey', 'policyVersion', 'policyHash',
      'validationSnapshot', 'validationSnapshotHash', 'requiredQuorum', 'expiresAt', 'resolvedAt',
    ]) {
      expect(dmmfField('ApprovalRequest', name).isRequired).toBe(false);
    }
  });

  it('existing commandRunId/pullRequestId/reason/status/createdAt fields are unchanged (additive only)', () => {
    expect(dmmfField('ApprovalRequest', 'commandRunId').isRequired).toBe(false);
    expect(dmmfField('ApprovalRequest', 'pullRequestId').isRequired).toBe(false);
    expect(dmmfField('ApprovalRequest', 'reason').isRequired).toBe(false);
    expect(dmmfField('ApprovalRequest', 'status').hasDefaultValue).toBe(true);
    expect(dmmfField('ApprovalRequest', 'status').default).toBe('pending');
  });

  it('packages/business/src/governance/approval-db.ts stays the unchanged legacy writer — never references any new canonical column/field', () => {
    const approvalDbSource = readFileSync(
      join(__dirname, '../../business/src/governance/approval-db.ts'),
      'utf8',
    );
    for (const name of [
      'legacyUnbound', 'artifactVersionId', 'requestedByAssignmentId', 'ownerAssignmentId',
      'ownershipRevision', 'validationSnapshot', 'policyHash', 'requiredQuorum',
    ]) {
      expect(approvalDbSource).not.toContain(name);
    }
  });
});

describe('[SCHEMA ASSERTION] ApprovalRequest — distinct exact U012 composite assignment relations', () => {
  it('requestedByAssignment uses fields [requestedByAssignmentId, companyId] -> references [id, companyId], never an ID-only FK', () => {
    const model = dmmfModel('ApprovalRequest');
    const rel = model.fields.find((f) => f.name === 'requestedByAssignment');
    expect(rel).toBeDefined();
    expect(rel!.relationFromFields).toEqual(['requestedByAssignmentId', 'companyId']);
    expect(rel!.relationToFields).toEqual(['id', 'companyId']);
    expect(rel!.relationFromFields!.length).toBeGreaterThan(1);
  });

  it('ownerAssignment uses fields [ownerAssignmentId, companyId] -> references [id, companyId], a DISTINCT relation from requestedByAssignment', () => {
    const model = dmmfModel('ApprovalRequest');
    const rel = model.fields.find((f) => f.name === 'ownerAssignment');
    expect(rel).toBeDefined();
    expect(rel!.relationFromFields).toEqual(['ownerAssignmentId', 'companyId']);
    expect(rel!.relationToFields).toEqual(['id', 'companyId']);
    const requestedByRel = model.fields.find((f) => f.name === 'requestedByAssignment');
    expect(rel!.relationName).not.toBe(requestedByRel!.relationName);
  });

  it('has no ID-only assignment relation anywhere on the model (every relation targeting UserCompanyRole carries exactly 2 FK columns)', () => {
    const model = dmmfModel('ApprovalRequest');
    const ucrRelations = model.fields.filter((f) => f.kind === 'object' && f.type === 'UserCompanyRole');
    expect(ucrRelations.length).toBe(2);
    for (const rel of ucrRelations) {
      expect(rel.relationFromFields!.length).toBe(2);
    }
  });

  it('company/project/artifactVersion relations use the exact composite scope-closure FKs', () => {
    const model = dmmfModel('ApprovalRequest');
    expect(model.fields.find((f) => f.name === 'company')!.relationFromFields).toEqual(['tenantId', 'companyId']);
    expect(model.fields.find((f) => f.name === 'project')!.relationFromFields).toEqual(['companyId', 'projectId']);
    expect(model.fields.find((f) => f.name === 'artifactVersion')!.relationFromFields).toEqual(['artifactVersionId']);
  });
});

describe('[SCHEMA ASSERTION] PG16/UTF8/pgcrypto validation-snapshot digest — no JS hash authoritative', () => {
  it('migration.sql requires PostgreSQL major 16 and server_encoding=UTF8', () => {
    expect(MIGRATION_SQL).toMatch(/RAISE EXCEPTION 'version_bound_approval migration requires PostgreSQL major version 16/);
    expect(MIGRATION_SQL).toMatch(/RAISE EXCEPTION 'version_bound_approval migration requires server_encoding=UTF8/);
  });

  it('installs pgcrypto and the exact sangfor_validation_snapshot_sha256(jsonb) function using convert_to(...,\'UTF8\') + digest + sha256 + hex', () => {
    expect(MIGRATION_SQL).toContain('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;');
    expect(MIGRATION_SQL).toMatch(/CREATE OR REPLACE FUNCTION public\.sangfor_validation_snapshot_sha256\(v jsonb\)\s*\nRETURNS text/);
    expect(MIGRATION_SQL).toMatch(/encode\(public\.digest\(pg_catalog\.convert_to\(\(v\)::text, 'UTF8'\), 'sha256'\), 'hex'\)/);
  });

  it('the digest function is the SOLE validation-snapshot hash authority — no JS canonicalization/digest module exists for it in this package', () => {
    expect(existsSync(join(__dirname, 'validation-snapshot-hash.ts'))).toBe(false);
  });

  it('validationSnapshotHash is a plain nullable String scalar (DB-generated-compatible — filled by the trigger, not a Prisma default)', () => {
    const field = dmmfField('ApprovalRequest', 'validationSnapshotHash');
    expect(field.type).toBe('String');
    expect(field.isRequired).toBe(false);
    expect(field.hasDefaultValue).toBe(false);
  });

  it('the named approval_request_validation_snapshot_guard trigger fills an omitted hash and rejects a mismatched supplied hash on INSERT', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE TRIGGER approval_request_validation_snapshot_guard_trg\s*\nBEFORE INSERT OR UPDATE ON approval_requests/);
    expect(MIGRATION_SQL).toMatch(/NEW\.validation_snapshot_hash := v_recomputed;/);
    expect(MIGRATION_SQL).toMatch(/supplied validation_snapshot_hash does not equal sangfor_validation_snapshot_sha256/);
  });

  it('the same trigger denies any UPDATE that changes validationSnapshot or validationSnapshotHash, even together/matching', () => {
    expect(MIGRATION_SQL).toMatch(/validation_snapshot\/validation_snapshot_hash are immutable after insert/);
    expect(MIGRATION_SQL).toMatch(/NEW\.validation_snapshot IS DISTINCT FROM OLD\.validation_snapshot\s*\n\s*OR NEW\.validation_snapshot_hash IS DISTINCT FROM OLD\.validation_snapshot_hash/);
  });

  it('a canonical-row CHECK requires exactly 64 lowercase hex for validationSnapshotHash/artifactHashSnapshot/policyHash', () => {
    expect(MIGRATION_SQL).toContain("CHECK (validation_snapshot_hash IS NULL OR validation_snapshot_hash ~ '^[0-9a-f]{64}$')");
    expect(MIGRATION_SQL).toContain("CHECK (artifact_hash_snapshot IS NULL OR artifact_hash_snapshot ~ '^[0-9a-f]{64}$')");
    expect(MIGRATION_SQL).toContain("CHECK (policy_hash IS NULL OR policy_hash ~ '^[0-9a-f]{64}$')");
  });

  it('the migration never hashes or upgrades a legacy row into authority (no UPDATE ... SET legacy_unbound = false)', () => {
    expect(MIGRATION_SQL).not.toMatch(/SET\s+"?legacy_unbound"?\s*=\s*false/i);
  });

  it('a partial unique index bounds at most one OPEN request per (artifact_version_id, action, policy_hash)', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE UNIQUE INDEX "approval_requests_open_unique_idx" ON "approval_requests"\("artifact_version_id", "action", "policy_hash"\)/);
    expect(MIGRATION_SQL).toMatch(/WHERE "legacy_unbound" = false AND "status" IN \('pending', 'ready_for_human_approval'\)/);
  });
});

describe('[SCHEMA ASSERTION] ApprovalRequest.status — exact vocabulary and terminal graph, legacyUnbound=false only', () => {
  it('the CHECK constraint fixes the exact 6-value vocabulary', () => {
    expect(MIGRATION_SQL).toContain(
      "CHECK (status IN ('pending', 'ready_for_human_approval', 'approved', 'rejected', 'cancelled', 'expired'))",
    );
  });

  it('the graph trigger only enforces the adjacency when BOTH sides are legacyUnbound=false', () => {
    expect(MIGRATION_SQL).toMatch(/IF NOT OLD\.legacy_unbound AND NOT NEW\.legacy_unbound THEN/);
  });

  it('declares the exact pending/ready_for_human_approval adjacency with no exit from a terminal state', () => {
    expect(MIGRATION_SQL).toMatch(/WHEN 'pending' THEN ARRAY\['ready_for_human_approval', 'cancelled', 'expired'\]/);
    expect(MIGRATION_SQL).toMatch(/WHEN 'ready_for_human_approval' THEN ARRAY\['approved', 'rejected', 'cancelled', 'expired'\]/);
    expect(MIGRATION_SQL).toMatch(/ELSE ARRAY\[\]::text\[\]/);
  });
});

describe('[SCHEMA ASSERTION] ApprovalDecision — DMMF (CHILD_VIA_FK, no redundant companyId), append-only', () => {
  it('has no companyId column at all', () => {
    const model = dmmfModel('ApprovalDecision');
    expect(model.fields.some((f) => f.name === 'companyId')).toBe(false);
  });

  it('approvalRequestId is the sole mandatory relation basis, targeting ApprovalRequest', () => {
    const model = dmmfModel('ApprovalDecision');
    const rel = model.fields.find((f) => f.name === 'approvalRequest');
    expect(rel).toBeDefined();
    expect(rel!.type).toBe('ApprovalRequest');
    expect(rel!.relationFromFields).toEqual(['approvalRequestId']);
    expect(rel!.isRequired).toBe(true);
  });

  it('actorAssignmentId is a plain required scalar with NO Prisma-level relation to UserCompanyRole (the named insert guard trigger enforces same-company membership instead)', () => {
    const model = dmmfModel('ApprovalDecision');
    const scalarField = model.fields.find((f) => f.name === 'actorAssignmentId');
    expect(scalarField).toBeDefined();
    expect(scalarField!.kind).toBe('scalar');
    expect(scalarField!.isRequired).toBe(true);
    const anyUcrRelation = model.fields.some((f) => f.kind === 'object' && f.type === 'UserCompanyRole');
    expect(anyUcrRelation).toBe(false);
  });

  it('sequence is positive, requestRevision non-negative, decision restricted to approve|reject', () => {
    expect(MIGRATION_SQL).toContain('CHECK (sequence > 0)');
    expect(MIGRATION_SQL).toContain('CHECK (request_revision >= 0)');
    expect(MIGRATION_SQL).toContain("CHECK (decision IN ('approve', 'reject'))");
  });

  it('exposes exactly the (approvalRequestId,sequence) and (approvalRequestId,actorAssignmentId) unique constraints', () => {
    const model = dmmfModel('ApprovalDecision');
    const uniqueFieldSets = model.uniqueIndexes.map((u) => [...u.fields].sort());
    expect(uniqueFieldSets).toContainEqual(['approvalRequestId', 'sequence'].sort());
    expect(uniqueFieldSets).toContainEqual(['actorAssignmentId', 'approvalRequestId'].sort());
  });

  it('the named parent-guard insert trigger joins approvalRequestId -> approval_requests.company_id, rejects a cross-company actor, and rejects any decision against a legacyUnbound=true parent', () => {
    expect(MIGRATION_SQL).toContain('sangfor_approval_decision_guard_trg');
    expect(MIGRATION_SQL).toMatch(/SELECT id, company_id, legacy_unbound, artifact_version_id, artifact_hash_snapshot, policy_hash, revision\s*\n\s*INTO v_request\s*\n\s*FROM approval_requests/);
    expect(MIGRATION_SQL).toMatch(/is legacy_unbound=true and confers no canonical authority; no decision may be recorded against it/);
    expect(MIGRATION_SQL).toMatch(/FROM user_company_roles WHERE id = NEW\.actor_assignment_id AND company_id = v_request\.company_id/);
  });

  it('the parent-guard trigger rejects a decision whose version/hash/policy/request-revision does not match the parent', () => {
    expect(MIGRATION_SQL).toMatch(/version mismatch/);
    expect(MIGRATION_SQL).toMatch(/hash mismatch/);
    expect(MIGRATION_SQL).toMatch(/policy mismatch/);
    expect(MIGRATION_SQL).toMatch(/request-revision mismatch/);
  });

  it('installs a deny-mutation trigger on both UPDATE and DELETE, reusing the existing sangfor_deny_mutation() function (no redefinition)', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE TRIGGER sangfor_approval_decisions_deny_update_trg\s*\nBEFORE UPDATE ON approval_decisions\s*\nFOR EACH ROW EXECUTE FUNCTION public\.sangfor_deny_mutation\(\);/);
    expect(MIGRATION_SQL).toMatch(/CREATE TRIGGER sangfor_approval_decisions_deny_delete_trg\s*\nBEFORE DELETE ON approval_decisions\s*\nFOR EACH ROW EXECUTE FUNCTION public\.sangfor_deny_mutation\(\);/);
    expect(MIGRATION_SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\.sangfor_deny_mutation/);
  });
});

describe('[SCHEMA ASSERTION] ApprovalCurrentValidity — one-to-one mutable projection', () => {
  it('approvalRequestId is both the primary key and the sole FK basis (true one-to-one)', () => {
    const model = dmmfModel('ApprovalCurrentValidity');
    const idField = model.fields.find((f) => f.isId);
    expect(idField!.name).toBe('approvalRequestId');
    const rel = model.fields.find((f) => f.name === 'approvalRequest');
    expect(rel!.relationFromFields).toEqual(['approvalRequestId']);
  });

  it('quorum/state CHECK constraints match the dispatch invariants', () => {
    expect(MIGRATION_SQL).toContain('CHECK (required_quorum >= 1)');
    expect(MIGRATION_SQL).toContain('CHECK (satisfied_quorum >= 0 AND satisfied_quorum <= required_quorum)');
    expect(MIGRATION_SQL).toContain('CHECK (last_decision_sequence >= satisfied_quorum)');
    expect(MIGRATION_SQL).toContain("CHECK (state IN ('pending', 'valid', 'invalid', 'stale', 'expired', 'revoked'))");
  });

  it('the guard trigger requires snapshot fields to match the CURRENT parent ApprovalRequest row (revision/version/hash/policy/quorum)', () => {
    expect(MIGRATION_SQL).toMatch(/revision\/version\/hash\/policy\/quorum mismatch/);
  });

  it('the guard trigger rejects any projection against a legacyUnbound=true parent (authority-zero invariant)', () => {
    expect(MIGRATION_SQL).toMatch(/is legacy_unbound=true and confers no canonical authority; no projection is permitted/);
  });

  it('declares the exact projection graph with no resurrection out of a terminal state', () => {
    expect(MIGRATION_SQL).toMatch(/WHEN 'pending' THEN ARRAY\['valid', 'invalid', 'stale', 'expired'\]/);
    expect(MIGRATION_SQL).toMatch(/WHEN 'valid' THEN ARRAY\['stale', 'expired', 'revoked'\]/);
    expect(MIGRATION_SQL).toMatch(/a new row cannot start directly at revoked/);
  });

  it('declares the valid/invalid/expired structural preconditions against the parent request status', () => {
    expect(MIGRATION_SQL).toMatch(/state=valid requires the parent request status=approved/);
    expect(MIGRATION_SQL).toMatch(/state=valid requires satisfied_quorum >= required_quorum and > 0 \(distinct quorum\)/);
    expect(MIGRATION_SQL).toMatch(/state=valid requires a non-null evaluatedAt/);
    expect(MIGRATION_SQL).toMatch(/state=invalid requires the parent request status IN \(rejected,cancelled\)/);
    expect(MIGRATION_SQL).toMatch(/state=expired requires the parent request status=expired, or an approved request whose validUntil has elapsed/);
  });

  it('the migration never inserts an ApprovalCurrentValidity row (schema only — no valid-from-migration authority)', () => {
    expect(MIGRATION_SQL).not.toMatch(/INSERT INTO\s+"?approval_current_validity"?/i);
    expect(MIGRATION_SQL).not.toMatch(/INSERT INTO\s+"?approval_decisions"?/i);
  });
});

describe('[SCHEMA ASSERTION] no migration statement advances a canonical request to READY/terminal or upgrades legacy authority', () => {
  it('never sets status to ready_for_human_approval/approved/rejected/cancelled/expired directly', () => {
    expect(MIGRATION_SQL).not.toMatch(/UPDATE\s+"?approval_requests"?\s+SET[^;]*status\s*=\s*'(ready_for_human_approval|approved|rejected|cancelled|expired)'/i);
  });

  it('never inserts a row into approval_requests (schema/trigger/function only)', () => {
    expect(MIGRATION_SQL).not.toMatch(/INSERT INTO\s+"?approval_requests"?/i);
  });
});
