import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../prisma/migrations/20260715190000_workflow_definition_run/migration.sql'),
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

describe('[SCHEMA ASSERTION] WorkflowDefinition — DMMF revision/artifact-link shape', () => {
  it('revision is Int, defaults to 0, non-negative', () => {
    const field = dmmfField('WorkflowDefinition', 'revision');
    expect(field.type).toBe('Int');
    expect(field.hasDefaultValue).toBe(true);
    expect(field.default).toBe(0);
    expect(MIGRATION_SQL).toContain('CHECK (revision >= 0)');
  });

  it('status defaults to draft and version is required/positive', () => {
    const status = dmmfField('WorkflowDefinition', 'status');
    expect(status.hasDefaultValue).toBe(true);
    expect(status.default).toBe('draft');
    const version = dmmfField('WorkflowDefinition', 'version');
    expect(version.isRequired).toBe(true);
    expect(MIGRATION_SQL).toContain('CHECK (version > 0)');
  });

  it('definitionArtifactVersionId is a required scalar with a genuine Prisma FK to ArtifactVersion', () => {
    const scalar = dmmfField('WorkflowDefinition', 'definitionArtifactVersionId');
    expect(scalar.isRequired).toBe(true);
    const rel = dmmfModel('WorkflowDefinition').fields.find((f) => f.name === 'definitionArtifactVersion');
    expect(rel).toBeDefined();
    expect(rel!.type).toBe('ArtifactVersion');
    expect(rel!.relationFromFields).toEqual(['definitionArtifactVersionId']);
    expect(rel!.isRequired).toBe(true);
  });

  it('definitionHashVersion/definitionHash/definitionJson are all required', () => {
    for (const name of ['definitionHashVersion', 'definitionHash', 'definitionJson']) {
      expect(dmmfField('WorkflowDefinition', name).isRequired).toBe(true);
    }
  });

  it('uses the exact U012 same-company composite assignment relation for createdByAssignment: fields [createdByAssignmentId, companyId] -> references [id, companyId], never an ID-only FK', () => {
    const model = dmmfModel('WorkflowDefinition');
    const rel = model.fields.find((f) => f.name === 'createdByAssignment');
    expect(rel).toBeDefined();
    expect(rel!.relationFromFields).toEqual(['createdByAssignmentId', 'companyId']);
    expect(rel!.relationToFields).toEqual(['id', 'companyId']);
    expect(rel!.relationFromFields!.length).toBeGreaterThan(1);
  });

  it('has no ID-only assignment relation anywhere on the model (every relation targeting UserCompanyRole carries exactly 2 FK columns)', () => {
    const model = dmmfModel('WorkflowDefinition');
    const ucrRelations = model.fields.filter((f) => f.kind === 'object' && f.type === 'UserCompanyRole');
    expect(ucrRelations.length).toBe(1);
    for (const rel of ucrRelations) {
      expect(rel.relationFromFields!.length).toBe(2);
    }
  });

  it('exposes exactly the (projectId, workflowKey, version) unique constraint', () => {
    const model = dmmfModel('WorkflowDefinition');
    const uniqueFieldSets = model.uniqueIndexes.map((u) => [...u.fields].sort());
    expect(uniqueFieldSets).toContainEqual(['projectId', 'version', 'workflowKey'].sort());
  });
});

describe('[SCHEMA ASSERTION] WorkflowDefinition — exact U017 hash-version/JCS-envelope reuse, never a second serializer/hash', () => {
  it('CHECK constraints fix the exact content_hash_version literal and the 64-lowercase-hex definition_hash format', () => {
    expect(MIGRATION_SQL).toContain("CHECK (definition_hash_version = 'artifact-content/rfc8785-jcs-sha256/v1')");
    expect(MIGRATION_SQL).toContain("CHECK (definition_hash ~ '^[0-9a-f]{64}$')");
  });

  it('installs no new canonicalization/digest function — reuses U017s sangfor_rfc8785_jcs_v1/sangfor_sha256_utf8 and JS canonical-content-hash.ts exclusively', () => {
    expect(MIGRATION_SQL).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.sangfor_rfc8785_jcs_v1/);
    expect(MIGRATION_SQL).not.toMatch(/CREATE (OR REPLACE )?FUNCTION public\.sangfor_sha256_utf8/);
    expect(MIGRATION_SQL).toMatch(/reuses U017's existing/);
  });

  it('the guard trigger joins definitionArtifactVersionId -> artifact_versions/artifacts and checks artifactType, scope, hash-version, digest, and content_json equality', () => {
    expect(MIGRATION_SQL).toContain('sangfor_workflow_definition_guard_trg');
    expect(MIGRATION_SQL).toMatch(/FROM artifact_versions av\s*\n\s*JOIN artifacts a ON a\.id = av\.artifact_id/);
    expect(MIGRATION_SQL).toMatch(/does not reference a workflow-definition artifact/);
    expect(MIGRATION_SQL).toMatch(/scope mismatch/);
    expect(MIGRATION_SQL).toMatch(/hash-version mismatch/);
    expect(MIGRATION_SQL).toMatch(/digest mismatch/);
    expect(MIGRATION_SQL).toMatch(/JSON mismatch/);
  });
});

describe('[SCHEMA ASSERTION] WorkflowDefinition — six activation-snapshot fields, all-or-none, immutability, active-status gate', () => {
  it('DMMF exposes all six nullable activation-snapshot fields including activationApprovalRequestRevision', () => {
    for (const name of [
      'activationApprovalRequestId',
      'activationApprovalRequestRevision',
      'activationApprovalArtifactVersionId',
      'activationApprovalArtifactHash',
      'activationApprovalPolicyHash',
      'activationApprovedAt',
    ]) {
      expect(dmmfField('WorkflowDefinition', name).isRequired).toBe(false);
    }
  });

  it('migration.sql declares the all-or-none CHECK across all six fields', () => {
    expect(MIGRATION_SQL).toContain('workflow_definitions_activation_all_or_none_check');
    expect(MIGRATION_SQL).toMatch(/activation_approval_request_id IS NULL AND activation_approval_request_revision IS NULL AND activation_approval_artifact_version_id IS NULL AND activation_approval_artifact_hash IS NULL AND activation_approval_policy_hash IS NULL AND activation_approved_at IS NULL/);
    expect(MIGRATION_SQL).toMatch(/activation_approval_request_id IS NOT NULL AND activation_approval_request_revision IS NOT NULL AND activation_approval_artifact_version_id IS NOT NULL AND activation_approval_artifact_hash IS NOT NULL AND activation_approval_policy_hash IS NOT NULL AND activation_approved_at IS NOT NULL/);
  });

  it("an active row requires the snapshot to be complete and to byte-match this row's own definition artifact identity (same-row CHECKs)", () => {
    expect(MIGRATION_SQL).toContain('workflow_definitions_active_requires_snapshot_check');
    expect(MIGRATION_SQL).toContain('CHECK (status <> \'active\' OR activation_approval_request_id IS NOT NULL)');
    expect(MIGRATION_SQL).toContain('CHECK (activation_approval_artifact_version_id IS NULL OR activation_approval_artifact_version_id = definition_artifact_version_id)');
    expect(MIGRATION_SQL).toContain('CHECK (activation_approval_artifact_hash IS NULL OR activation_approval_artifact_hash = definition_hash)');
  });

  it("the guard trigger requires an active row's activation revision to correlate to a real ApprovalCurrentValidity row, and NEVER asserts state=valid itself", () => {
    expect(MIGRATION_SQL).toMatch(/FROM approval_current_validity acv\s*\n\s*JOIN approval_requests ar ON ar\.id = acv\.approval_request_id/);
    expect(MIGRATION_SQL).toMatch(/structural existence only — this does NOT assert state=valid; U025 re-evaluates validity/);
    expect(MIGRATION_SQL).not.toMatch(/acv\.state\s*=\s*'valid'/);
  });

  it('the guard trigger rejects a cross-scope ApprovalRequest reference on activation', () => {
    expect(MIGRATION_SQL).toMatch(/the referenced ApprovalRequest''s scope does not match this row''s own scope \(cross-scope link\)/);
  });

  it('the guard trigger makes the whole identity/snapshot immutable once the row leaves draft, except the single active->retired transition', () => {
    expect(MIGRATION_SQL).toMatch(/a definition row\/version cannot be edited after leaving draft/);
    expect(MIGRATION_SQL).toMatch(/WHEN 'active' THEN ARRAY\['retired'\]/);
  });

  it('a legacy_disabled row requires its definitionArtifactVersionId to reference a legacy_unreviewed ArtifactVersion', () => {
    expect(MIGRATION_SQL).toMatch(/status=legacy_disabled requires definition_artifact_version_id to reference a legacy_unreviewed ArtifactVersion/);
  });

  it('the revision CAS trigger requires a new row to start at 0 and every UPDATE to increment by exactly 1', () => {
    expect(MIGRATION_SQL).toMatch(/a new row must begin at revision 0/);
    expect(MIGRATION_SQL).toMatch(/revision IS DISTINCT FROM OLD\.revision \+ 1/);
  });

  it('a partial unique index bounds at most one ACTIVE version per (project_id, workflow_key)', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE UNIQUE INDEX "workflow_definitions_one_active_per_key_idx" ON "workflow_definitions"\("project_id", "workflow_key"\)/);
    expect(MIGRATION_SQL).toMatch(/WHERE "status" = 'active'/);
  });
});

describe('[SCHEMA ASSERTION] WorkflowRun — DMMF scope/snapshot shape and exact U012 assignment relation', () => {
  it('workflowDefinition is a required relation with a genuine FK to WorkflowDefinition', () => {
    const rel = dmmfModel('WorkflowRun').fields.find((f) => f.name === 'workflowDefinition');
    expect(rel).toBeDefined();
    expect(rel!.type).toBe('WorkflowDefinition');
    expect(rel!.relationFromFields).toEqual(['workflowDefinitionId']);
    expect(rel!.isRequired).toBe(true);
  });

  it('definitionVersion/definitionArtifactVersionId/definitionArtifactHashVersion/definitionArtifactHash are all required', () => {
    for (const name of ['definitionVersion', 'definitionArtifactVersionId', 'definitionArtifactHashVersion', 'definitionArtifactHash']) {
      expect(dmmfField('WorkflowRun', name).isRequired).toBe(true);
    }
  });

  it('uses the exact U012 same-company composite assignment relation for requestedByAssignment, never an ID-only FK', () => {
    const model = dmmfModel('WorkflowRun');
    const rel = model.fields.find((f) => f.name === 'requestedByAssignment');
    expect(rel).toBeDefined();
    expect(rel!.relationFromFields).toEqual(['requestedByAssignmentId', 'companyId']);
    expect(rel!.relationToFields).toEqual(['id', 'companyId']);
    const ucrRelations = model.fields.filter((f) => f.kind === 'object' && f.type === 'UserCompanyRole');
    expect(ucrRelations.length).toBe(1);
    expect(ucrRelations[0]!.relationFromFields!.length).toBe(2);
  });

  it('exposes the scoped idempotency-key and legacy-source unique constraints', () => {
    const model = dmmfModel('WorkflowRun');
    const uniqueFieldSets = model.uniqueIndexes.map((u) => [...u.fields].sort());
    expect(uniqueFieldSets).toContainEqual(['idempotencyKey', 'projectId'].sort());
    expect(uniqueFieldSets).toContainEqual(['legacySourceId', 'legacySourceType'].sort());
  });
});

describe('[SCHEMA ASSERTION] WorkflowRun — exhaustive run status vocabulary and graph, legacy_imported has no inbound transition', () => {
  it('the CHECK constraint fixes the exact 7-value vocabulary', () => {
    expect(MIGRATION_SQL).toContain(
      "CHECK (status IN ('pending', 'running', 'blocked', 'succeeded', 'failed', 'cancelled', 'legacy_imported'))",
    );
  });

  it('declares the exact graph with no exit from a terminal state', () => {
    expect(MIGRATION_SQL).toMatch(/WHEN 'pending' THEN ARRAY\['running', 'cancelled'\]/);
    expect(MIGRATION_SQL).toMatch(/WHEN 'running' THEN ARRAY\['blocked', 'succeeded', 'failed', 'cancelled'\]/);
    expect(MIGRATION_SQL).toMatch(/WHEN 'blocked' THEN ARRAY\['running', 'failed', 'cancelled'\]/);
  });

  it('rejects any transition once a run is terminal (succeeded|failed|cancelled|legacy_imported)', () => {
    expect(MIGRATION_SQL).toMatch(/OLD\.status IN \('succeeded', 'failed', 'cancelled', 'legacy_imported'\)/);
    expect(MIGRATION_SQL).toMatch(/is terminal; no further transition is permitted/);
  });

  it('legacy_imported is never reachable via the transition graph (no CASE branch maps to it)', () => {
    const graphBlock = MIGRATION_SQL.slice(MIGRATION_SQL.indexOf("v_allowed_next := CASE OLD.status\n        WHEN 'pending'"));
    const firstEndCase = graphBlock.indexOf('END;');
    const runGraphSnippet = graphBlock.slice(0, firstEndCase);
    expect(runGraphSnippet).not.toContain('legacy_imported');
  });
});

describe('[SCHEMA ASSERTION] WorkflowRun — copied activation snapshot (six fields incl activationApprovedAt) and run-gate (six fields incl runApprovalRequestRevision)', () => {
  it('DMMF exposes all six nullable activation-snapshot fields', () => {
    for (const name of [
      'activationApprovalRequestId',
      'activationApprovalRequestRevision',
      'activationApprovalArtifactVersionId',
      'activationApprovalArtifactHash',
      'activationApprovalPolicyHash',
      'activationApprovedAt',
    ]) {
      expect(dmmfField('WorkflowRun', name).isRequired).toBe(false);
    }
  });

  it('DMMF exposes all six nullable run-gate fields including runApprovalRequestRevision', () => {
    for (const name of [
      'runApprovalRequestId',
      'runApprovalRequestRevision',
      'runApprovalArtifactVersionId',
      'runApprovalArtifactHash',
      'runApprovalPolicyHash',
      'runApprovedAt',
    ]) {
      expect(dmmfField('WorkflowRun', name).isRequired).toBe(false);
    }
  });

  it('migration.sql declares all-or-none CHECKs for both the activation and run-gate snapshots', () => {
    expect(MIGRATION_SQL).toContain('workflow_runs_activation_all_or_none_check');
    expect(MIGRATION_SQL).toContain('workflow_runs_run_gate_all_or_none_check');
  });

  it("the guard trigger requires a non-legacy_imported run to copy the parent WorkflowDefinition's activation snapshot byte-for-byte, including activationApprovedAt", () => {
    expect(MIGRATION_SQL).toMatch(/a non-legacy_imported run must copy the parent WorkflowDefinition''s activation snapshot byte-for-byte/);
    expect(MIGRATION_SQL).toMatch(/NEW\.activation_approved_at IS DISTINCT FROM v_def\.activation_approved_at/);
  });

  it('a legacy_imported run requires its definitionArtifactVersionId to reference a legacy_unreviewed ArtifactVersion', () => {
    expect(MIGRATION_SQL).toMatch(/status=legacy_imported requires definition_artifact_version_id to reference a legacy_unreviewed ArtifactVersion/);
  });

  it('every identity/snapshot column (including all twelve activation+run-gate fields) is immutable after insert', () => {
    expect(MIGRATION_SQL).toMatch(/identity\/snapshot columns are immutable after insert/);
    expect(MIGRATION_SQL).toMatch(/NEW\.run_approved_at IS DISTINCT FROM OLD\.run_approved_at/);
  });

  it('the run-gate check joins run_approval_request_id -> approval_requests, rejects legacy_unbound=true and cross-scope, and matches revision/version/hash/policy against the LIVE row', () => {
    expect(MIGRATION_SQL).toMatch(/FROM approval_requests\s*\n\s*WHERE id = NEW\.run_approval_request_id/);
    expect(MIGRATION_SQL).toMatch(/confers no canonical authority; no run gate may reference it/);
    expect(MIGRATION_SQL).toMatch(/the referenced run-gate ApprovalRequest''s scope does not match this run''s own scope \(cross-scope link\)/);
    expect(MIGRATION_SQL).toMatch(/revision mismatch/);
    expect(MIGRATION_SQL).toMatch(/version mismatch/);
    expect(MIGRATION_SQL).toMatch(/hash mismatch/);
    expect(MIGRATION_SQL).toMatch(/policy mismatch/);
  });
});

describe('[SCHEMA ASSERTION] WorkflowRun/WorkflowRunStep — aggregate guards and cascade cancellation', () => {
  it('run succeeded requires every step succeeded|skipped', () => {
    expect(MIGRATION_SQL).toMatch(/status=succeeded requires every step to be succeeded\|skipped/);
    expect(MIGRATION_SQL).toMatch(/status NOT IN \('succeeded', 'skipped'\)/);
  });

  it('run failed requires at least one failed step', () => {
    expect(MIGRATION_SQL).toMatch(/status=failed requires at least one failed step/);
  });

  it('installs an AFTER UPDATE cascade that CAS-cancels every nonterminal step when the run itself is cancelled', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE TRIGGER sangfor_workflow_run_cascade_cancel_trg\s*\nAFTER UPDATE ON workflow_runs/);
    expect(MIGRATION_SQL).toMatch(/SET status = 'cancelled', revision = revision \+ 1/);
    expect(MIGRATION_SQL).toMatch(/status NOT IN \('succeeded', 'failed', 'skipped', 'cancelled'\)/);
  });
});

describe('[SCHEMA ASSERTION] WorkflowRunStep — exhaustive step status vocabulary and graph, immutable stepKey', () => {
  it('the CHECK constraint fixes the exact 7-value vocabulary', () => {
    expect(MIGRATION_SQL).toContain(
      "CHECK (status IN ('pending', 'running', 'blocked', 'succeeded', 'failed', 'skipped', 'cancelled'))",
    );
  });

  it('declares the exact graph with no exit from a terminal state', () => {
    expect(MIGRATION_SQL).toMatch(/WHEN 'pending' THEN ARRAY\['running', 'skipped', 'cancelled'\]/);
    expect(MIGRATION_SQL).toMatch(/WHEN 'running' THEN ARRAY\['blocked', 'succeeded', 'failed', 'cancelled'\]/);
    expect(MIGRATION_SQL).toMatch(/WHEN 'blocked' THEN ARRAY\['running', 'failed', 'cancelled'\]/);
  });

  it('rejects any transition once a step is terminal (succeeded|failed|skipped|cancelled)', () => {
    expect(MIGRATION_SQL).toMatch(/OLD\.status IN \('succeeded', 'failed', 'skipped', 'cancelled'\)/);
  });

  it('workflowRunId and stepKey are immutable', () => {
    expect(MIGRATION_SQL).toMatch(/workflow_run_steps\.workflow_run_id is immutable/);
    expect(MIGRATION_SQL).toMatch(/workflow_run_steps\.step_key is immutable/);
  });

  it('CHILD_VIA_FK through the mandatory run relation only, unique on (workflowRunId, stepKey)', () => {
    const model = dmmfModel('WorkflowRunStep');
    const rel = model.fields.find((f) => f.name === 'run');
    expect(rel!.type).toBe('WorkflowRun');
    expect(rel!.relationFromFields).toEqual(['workflowRunId']);
    expect(rel!.isRequired).toBe(true);
    const uniqueFieldSets = model.uniqueIndexes.map((u) => [...u.fields].sort());
    expect(uniqueFieldSets).toContainEqual(['stepKey', 'workflowRunId'].sort());
  });
});

describe('[SCHEMA ASSERTION] WorkflowRunArtifact — CHILD_VIA_FK, genuine ArtifactVersion FK, cross-scope guard', () => {
  it('has no companyId column at all', () => {
    const model = dmmfModel('WorkflowRunArtifact');
    expect(model.fields.some((f) => f.name === 'companyId')).toBe(false);
  });

  it('run and artifactVersion are both required relations with genuine FKs', () => {
    const model = dmmfModel('WorkflowRunArtifact');
    const runRel = model.fields.find((f) => f.name === 'run');
    expect(runRel!.type).toBe('WorkflowRun');
    expect(runRel!.relationFromFields).toEqual(['workflowRunId']);
    expect(runRel!.isRequired).toBe(true);
    const artRel = model.fields.find((f) => f.name === 'artifactVersion');
    expect(artRel!.type).toBe('ArtifactVersion');
    expect(artRel!.relationFromFields).toEqual(['artifactVersionId']);
    expect(artRel!.isRequired).toBe(true);
  });

  it('direction is restricted to input|output', () => {
    expect(MIGRATION_SQL).toContain("CHECK (direction IN ('input', 'output'))");
  });

  it('the named insert guard trigger rejects a cross-scope ArtifactVersion link', () => {
    expect(MIGRATION_SQL).toContain('sangfor_workflow_run_artifact_guard_trg');
    expect(MIGRATION_SQL).toMatch(/cross-scope link/);
  });

  it('exposes exactly the (workflowRunId, artifactVersionId, role) unique constraint', () => {
    const model = dmmfModel('WorkflowRunArtifact');
    const uniqueFieldSets = model.uniqueIndexes.map((u) => [...u.fields].sort());
    expect(uniqueFieldSets).toContainEqual(['artifactVersionId', 'role', 'workflowRunId'].sort());
  });
});

describe('[SCHEMA ASSERTION] WorkflowRunEvent — CHILD_VIA_FK, strictly-positive sequence, append-only', () => {
  it('has no companyId column at all', () => {
    const model = dmmfModel('WorkflowRunEvent');
    expect(model.fields.some((f) => f.name === 'companyId')).toBe(false);
  });

  it('run is the sole mandatory relation basis, targeting WorkflowRun', () => {
    const model = dmmfModel('WorkflowRunEvent');
    const rel = model.fields.find((f) => f.name === 'run');
    expect(rel).toBeDefined();
    expect(rel!.type).toBe('WorkflowRun');
    expect(rel!.relationFromFields).toEqual(['workflowRunId']);
    expect(rel!.isRequired).toBe(true);
  });

  it('sequence is strictly positive and unique per run', () => {
    expect(MIGRATION_SQL).toContain('CHECK (sequence > 0)');
    const model = dmmfModel('WorkflowRunEvent');
    const uniqueFieldSets = model.uniqueIndexes.map((u) => [...u.fields].sort());
    expect(uniqueFieldSets).toContainEqual(['sequence', 'workflowRunId'].sort());
  });

  it('actorAssignmentId is a plain optional scalar with NO Prisma-level relation to UserCompanyRole (the named insert guard trigger enforces same-company membership instead)', () => {
    const model = dmmfModel('WorkflowRunEvent');
    const scalarField = model.fields.find((f) => f.name === 'actorAssignmentId');
    expect(scalarField).toBeDefined();
    expect(scalarField!.kind).toBe('scalar');
    expect(scalarField!.isRequired).toBe(false);
    const anyUcrRelation = model.fields.some((f) => f.kind === 'object' && f.type === 'UserCompanyRole');
    expect(anyUcrRelation).toBe(false);
  });

  it('the named insert guard trigger joins workflow_run_id -> workflow_runs.company_id and rejects a cross-company actor when supplied', () => {
    expect(MIGRATION_SQL).toContain('sangfor_workflow_run_event_guard_trg');
    expect(MIGRATION_SQL).toMatch(/SELECT company_id INTO v_company_id FROM workflow_runs WHERE id = NEW\.workflow_run_id/);
    expect(MIGRATION_SQL).toMatch(/FROM user_company_roles WHERE id = NEW\.actor_assignment_id AND company_id = v_company_id/);
  });

  it('installs a deny-mutation trigger on both UPDATE and DELETE, reusing the existing sangfor_deny_mutation() function (no redefinition)', () => {
    expect(MIGRATION_SQL).toMatch(/CREATE TRIGGER sangfor_workflow_run_events_deny_update_trg\s*\nBEFORE UPDATE ON workflow_run_events\s*\nFOR EACH ROW EXECUTE FUNCTION public\.sangfor_deny_mutation\(\);/);
    expect(MIGRATION_SQL).toMatch(/CREATE TRIGGER sangfor_workflow_run_events_deny_delete_trg\s*\nBEFORE DELETE ON workflow_run_events\s*\nFOR EACH ROW EXECUTE FUNCTION public\.sangfor_deny_mutation\(\);/);
    expect(MIGRATION_SQL).not.toMatch(/CREATE OR REPLACE FUNCTION public\.sangfor_deny_mutation/);
  });
});

describe('[SCHEMA ASSERTION] no migration statement activates a definition, increments a revision, or starts a run', () => {
  it('never inserts a workflow_definitions row with status other than the DEFAULT draft (no INSERT ... status literal at all)', () => {
    expect(MIGRATION_SQL).not.toMatch(/INSERT INTO\s+"?workflow_definitions"?/i);
  });

  it('never inserts a workflow_runs, workflow_run_steps, workflow_run_artifacts, or workflow_run_events row', () => {
    expect(MIGRATION_SQL).not.toMatch(/INSERT INTO\s+"?workflow_runs"?/i);
    expect(MIGRATION_SQL).not.toMatch(/INSERT INTO\s+"?workflow_run_steps"?/i);
    expect(MIGRATION_SQL).not.toMatch(/INSERT INTO\s+"?workflow_run_artifacts"?/i);
    expect(MIGRATION_SQL).not.toMatch(/INSERT INTO\s+"?workflow_run_events"?/i);
  });

  it('never sets a workflow_definitions status literal via UPDATE (no activation) or bumps revision via a literal UPDATE', () => {
    expect(MIGRATION_SQL).not.toMatch(/UPDATE\s+"?workflow_definitions"?\s+SET[^;]*status\s*=\s*'(active|retired|legacy_disabled)'/i);
    expect(MIGRATION_SQL).not.toMatch(/UPDATE\s+"?workflow_definitions"?\s+SET[^;]*revision\s*=\s*\d/i);
  });

  it('column defaults leave every definition at revision 0 and status draft, and every run/step optimistic revision at 0', () => {
    expect(MIGRATION_SQL).toContain('"revision" INTEGER NOT NULL DEFAULT 0');
    expect(MIGRATION_SQL).toContain('"status" TEXT NOT NULL DEFAULT \'draft\'');
  });
});

describe('[SCHEMA ASSERTION] legacy Workflow/WorkflowStep/WorkflowTemplate remain untouched and non-authoritative', () => {
  it('the migration never alters the legacy workflows/workflow_steps/workflow_templates tables', () => {
    expect(MIGRATION_SQL).not.toMatch(/ALTER TABLE\s+"?workflows"?\s/i);
    expect(MIGRATION_SQL).not.toMatch(/ALTER TABLE\s+"?workflow_steps"?\s/i);
    expect(MIGRATION_SQL).not.toMatch(/ALTER TABLE\s+"?workflow_templates"?\s/i);
  });

  it('the legacy Workflow/WorkflowStep/WorkflowTemplate DMMF models are unchanged (still CHILD_VIA_FK-shaped / plain, no new fields)', () => {
    const workflow = dmmfModel('Workflow');
    expect(workflow.fields.find((f) => f.name === 'commandRun')!.relationFromFields).toEqual(['commandRunId']);
    const workflowStep = dmmfModel('WorkflowStep');
    expect(workflowStep.fields.find((f) => f.name === 'workflow')!.relationFromFields).toEqual(['workflowId']);
    const workflowTemplate = dmmfModel('WorkflowTemplate');
    expect(workflowTemplate.fields.map((f) => f.name)).toEqual(['id', 'templateKey', 'createdAt']);
  });
});
