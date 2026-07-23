import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const DB_ROOT = resolve(import.meta.dirname, '../..');
const TSX = resolve(DB_ROOT, 'node_modules/.bin/tsx');
const SCRIPT = resolve(DB_ROOT, 'scripts/backfill-domain-foundation.ts');

function classify(companyId: string, candidates: unknown[]) {
  const expression = `import { classifyOwnerAssignment } from ${JSON.stringify(SCRIPT)}; console.log(JSON.stringify(classifyOwnerAssignment({companyId:${JSON.stringify(companyId)},candidates:${JSON.stringify(candidates)}})));`;
  return JSON.parse(execFileSync(TSX, ['-e', expression], { encoding: 'utf8' }));
}

describe('U040 domain foundation backfill classifier', () => {
  it('quarantines an ambiguous same-company active owner mapping rather than selecting one', () => {
    const candidates = [
      { id: 'role-a', companyId: 'company-a', active: true },
      { id: 'role-b', companyId: 'company-a', active: true },
    ];

    expect(classify('company-a', candidates)).toEqual({
      kind: 'quarantine',
      reason: 'owner_assignment_ambiguous',
    });
  });

  it('accepts exactly one active same-company owner mapping', () => {
    const candidates = [
      { id: 'role-a', companyId: 'company-a', active: true },
      { id: 'role-b', companyId: 'company-b', active: true },
      { id: 'role-c', companyId: 'company-a', active: false },
    ];

    expect(classify('company-a', candidates)).toEqual({
      kind: 'apply',
      ownerAssignmentId: 'role-a',
    });
  });
});
